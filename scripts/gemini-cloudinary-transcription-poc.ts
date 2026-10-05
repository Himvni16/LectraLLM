import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import nextEnv from "@next/env";
import { v2 as cloudinary } from "cloudinary";

nextEnv.loadEnvConfig(process.cwd());

const { createCloudinaryVideoStore } = await import(
  "../src/lib/cloudinary/videos"
);
const {
  getCloudinaryConfig,
  getGeminiTranscriptionModel,
  getUploadLimits,
} = await import("../src/lib/env");
const { createGeminiTranscriptionClient } = await import(
  "../src/lib/transcription/gemini-client"
);
const { createCloudinaryVideoLocator } = await import(
  "../src/lib/transcription/media"
);

const [, , commandOrPath, value] = process.argv;
if (!commandOrPath) {
  throw new Error(
    "Usage:\n" +
      '  ... gemini-cloudinary-transcription-poc.ts upload "C:\\path\\lecture.mp4"\n' +
      "  ... gemini-cloudinary-transcription-poc.ts resume files/<gemini-file>\n" +
      "  ... gemini-cloudinary-transcription-poc.ts cleanup files/<gemini-file>",
  );
}

const command = ["upload", "resume", "cleanup"].includes(commandOrPath)
  ? commandOrPath
  : "upload";
const argument = command === "upload" && !value ? commandOrPath : value;
if (!argument) throw new Error(`The ${command} command requires an argument.`);

const config = getCloudinaryConfig();
const limits = getUploadLimits();
const store = createCloudinaryVideoStore({ config });
const client = createGeminiTranscriptionClient({ videoStore: store });

function safeError(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    config.apiKey,
    config.apiSecret,
    process.env.GEMINI_API_KEY,
  ]) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return new Error(`Cloudinary-to-Gemini POC failed: ${message}`);
}

async function upload(localVideoPath: string): Promise<void> {
  const videoPath = path.resolve(localVideoPath);
  const fileStats = await stat(videoPath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error("The POC path must reference a non-empty video file.");
  }
  const extension = path.extname(videoPath).toLowerCase();
  if (![".mp4", ".mov", ".webm"].includes(extension)) {
    throw new Error("The POC video must be MP4, MOV, or WebM.");
  }
  if (fileStats.size > limits.videoMaxSizeBytes) {
    throw new Error("The POC video exceeds the configured video limit.");
  }

  const publicId = `${config.uploadFolder}/${randomUUID()}`;
  let cloudinaryUploaded = false;
  try {
    await cloudinary.uploader.upload(videoPath, {
      resource_type: "video",
      public_id: publicId,
      overwrite: false,
      type: "authenticated",
    });
    cloudinaryUploaded = true;

    const metadata = await store.inspect(publicId);
    const locator = createCloudinaryVideoLocator({
      maxSizeBytes: limits.videoMaxSizeBytes,
      uploadFolder: config.uploadFolder,
      videoStore: { inspect: async () => metadata },
    });
    const video = await locator.locate(publicId, path.basename(videoPath));

    console.log(`Cloudinary public ID: ${publicId}`);
    console.log(`Video format: ${metadata.format}`);
    console.log(`Video byte size: ${metadata.bytes}`);

    const startedAt = performance.now();
    const providerFile = await client.upload(video);
    console.log(`Gemini model: ${getGeminiTranscriptionModel()}`);
    console.log(`Gemini file name: ${providerFile.name}`);
    console.log(`Gemini file state: ${providerFile.state}`);
    console.log(
      `Upload processing time: ${((performance.now() - startedAt) / 1_000).toFixed(2)} seconds`,
    );
    console.log(
      `Resume with: node --conditions=react-server --import tsx scripts/gemini-cloudinary-transcription-poc.ts resume ${providerFile.name}`,
    );
  } finally {
    if (cloudinaryUploaded) {
      try {
        await store.delete(publicId);
        console.log("Temporary Cloudinary video deleted.");
      } catch {
        console.warn("Temporary Cloudinary video cleanup failed.");
      }
    }
  }
}

async function resume(providerFileName: string): Promise<void> {
  const startedAt = performance.now();
  const providerFile = await client.getFile(providerFileName);
  console.log(`Gemini file name: ${providerFile.name}`);
  console.log(`Gemini file state: ${providerFile.state}`);

  if (providerFile.state === "PROCESSING") {
    console.log("Gemini is still processing. Run the resume command again later.");
    return;
  }
  if (providerFile.state !== "ACTIVE") {
    console.log(
      `Cleanup with: node --conditions=react-server --import tsx scripts/gemini-cloudinary-transcription-poc.ts cleanup ${providerFile.name}`,
    );
    return;
  }

  const result = await client.generate(providerFile);
  console.log(`Gemini model: ${result.model}`);
  console.log(
    `Resume processing time: ${((performance.now() - startedAt) / 1_000).toFixed(2)} seconds`,
  );
  console.log(`Transcript character length: ${result.text.length}`);
  console.log("Transcript preview (first 1000 characters):");
  console.log("---");
  console.log(result.text.slice(0, 1_000));
  console.log("---");
  await client.deleteFile(providerFile.name);
  console.log("Temporary Gemini file cleanup attempted.");
}

try {
  if (command === "upload") await upload(argument);
  if (command === "resume") await resume(argument);
  if (command === "cleanup") {
    await client.deleteFile(argument);
    console.log("Temporary Gemini file cleanup attempted.");
  }
} catch (error) {
  throw safeError(error);
}
