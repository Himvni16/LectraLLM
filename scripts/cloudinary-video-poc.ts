import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { v2 as cloudinary } from "cloudinary";
import nextEnv from "@next/env";

const [, , videoPathArgument] = process.argv;
if (!videoPathArgument) {
  throw new Error(
    'Usage: node --conditions=react-server --import tsx scripts/cloudinary-video-poc.ts "C:\\path\\lecture.mp4"',
  );
}
nextEnv.loadEnvConfig(process.cwd());

const videoPath = path.resolve(videoPathArgument);
const fileStats = await stat(videoPath);
if (!fileStats.isFile() || fileStats.size === 0) {
  throw new Error("The POC path must reference a non-empty video file.");
}
const extension = path.extname(videoPath).toLowerCase();
if (![".mp4", ".mov", ".webm"].includes(extension)) {
  throw new Error("The POC video must be MP4, MOV, or WebM.");
}

const { getCloudinaryConfig, getUploadLimits } = await import("../src/lib/env");
const { createCloudinaryVideoStore } = await import(
  "../src/lib/cloudinary/videos"
);
const config = getCloudinaryConfig();
if (fileStats.size > getUploadLimits().videoMaxSizeBytes) {
  throw new Error("The POC video exceeds the configured video limit.");
}
cloudinary.config({
  cloud_name: config.cloudName,
  api_key: config.apiKey,
  api_secret: config.apiSecret,
  secure: true,
});
const publicId = `${config.uploadFolder}/poc-${randomUUID()}`;
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
  console.log(`Public ID: ${metadata.publicId}`);
  console.log(`Format: ${metadata.format}`);
  console.log(`Size: ${metadata.bytes}`);
} finally {
  if (uploaded) {
    await store.delete(publicId);
    console.log("Temporary Cloudinary video deleted.");
  }
}
