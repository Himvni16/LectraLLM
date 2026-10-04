import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { v2 as cloudinary } from "cloudinary";
import nextEnv from "@next/env";

const [, , videoPathArgument] = process.argv;
if (!videoPathArgument) {
  throw new Error(
    'Usage: node --conditions=react-server --import tsx scripts/gemini-cloudinary-transcription-poc.ts "C:\\path\\lecture.mp4"',
  );
}
nextEnv.loadEnvConfig(process.cwd());

const { createCloudinaryVideoStore } = await import(
  "../src/lib/cloudinary/videos"
);
const { getCloudinaryConfig, getUploadLimits } = await import("../src/lib/env");
const { createGeminiTranscriptionClient } = await import(
  "../src/lib/transcription/gemini-client"
);
const { createCloudinaryVideoLocator } = await import(
  "../src/lib/transcription/media"
);

const videoPath = path.resolve(videoPathArgument);
const fileStats = await stat(videoPath);
if (!fileStats.isFile() || fileStats.size === 0) {
  throw new Error("The POC path must reference a non-empty video file.");
}
const extension = path.extname(videoPath).toLowerCase();
if (![".mp4", ".mov", ".webm"].includes(extension)) {
  throw new Error("The POC video must be MP4, MOV, or WebM.");
}

const config = getCloudinaryConfig();
const limits = getUploadLimits();
if (fileStats.size > limits.videoMaxSizeBytes) {
  throw new Error("The POC video exceeds the configured video limit.");
}

const publicId = `${config.uploadFolder}/${randomUUID()}`;
const store = createCloudinaryVideoStore({ config });
let uploaded = false;

try {
  await cloudinary.uploader.upload(videoPath, {
    resource_type: "video",
    public_id: publicId,
    overwrite: false,
    type: "authenticated",
  });
  uploaded = true;

  const metadata = await store.inspect(publicId);
  const locator = createCloudinaryVideoLocator({
    maxSizeBytes: limits.videoMaxSizeBytes,
    uploadFolder: config.uploadFolder,
    videoStore: { inspect: async () => metadata },
  });
  const video = await locator.locate(publicId, path.basename(videoPath));
  const client = createGeminiTranscriptionClient({ videoStore: store });

  console.log(`Cloudinary public ID: ${publicId}`);
  console.log(`Video format: ${metadata.format}`);
  console.log(`Video byte size: ${metadata.bytes}`);

  const startedAt = performance.now();
  const result = await client.transcribe(video);
  const elapsed = performance.now() - startedAt;

  console.log(`Gemini model: ${result.model}`);
  console.log(
    `Transcription processing time: ${(elapsed / 1_000).toFixed(2)} seconds`,
  );
  console.log(`Transcript character length: ${result.text.length}`);
  console.log("Transcript preview (first 1000 characters):");
  console.log("---");
  console.log(result.text.slice(0, 1_000));
  console.log("---");
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    config.apiKey,
    config.apiSecret,
    process.env.GEMINI_API_KEY,
  ]) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  throw new Error(`Cloudinary-to-Gemini POC failed: ${message}`);
} finally {
  if (uploaded) {
    try {
      await store.delete(publicId);
      console.log("Temporary Cloudinary video deleted.");
    } catch {
      console.warn("Temporary Cloudinary video cleanup failed.");
    }
  }
}
