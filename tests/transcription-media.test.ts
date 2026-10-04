import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCloudinaryVideoLocator,
  createStoredVideoLocator,
  StoredVideoUnavailableError,
} from "@/lib/transcription/media";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("stored transcription media lookup", () => {
  it("locates a Cloudinary video using verified asset metadata", async () => {
    const publicId =
      "lectrallm/videos/c38f8f62-4d06-4f2c-a3ca-d753442e7233";
    const locator = createCloudinaryVideoLocator({
      maxSizeBytes: 100,
      uploadFolder: "lectrallm/videos",
      videoStore: {
        inspect: async () => ({
          publicId,
          resourceType: "video",
          deliveryType: "authenticated",
          format: "mp4",
          bytes: 42,
          secureUrl: "https://res.cloudinary.com/cloud/video/upload/video.mp4",
        }),
      },
    });

    await expect(locator.locate(publicId, "lecture.mp4")).resolves.toEqual({
      publicId,
      fileName: "lecture.mp4",
      contentType: "video/mp4",
      size: 42,
    });
  });

  it("resolves only existing files inside storage/videos", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "lectrallm-transcription-test-"),
    );
    temporaryRoots.push(workspaceRoot);
    const videoDirectory = path.join(workspaceRoot, "storage", "videos");
    const storedPath = path.join(videoDirectory, "generated.mp4");
    await mkdir(videoDirectory, { recursive: true });
    await writeFile(storedPath, "video");
    const locator = createStoredVideoLocator({ workspaceRoot });

    await expect(
      locator.locate("storage/videos/generated.mp4", "lecture.mp4"),
    ).resolves.toEqual({
      absolutePath: storedPath,
      fileName: "lecture.mp4",
    });
  });

  it("rejects traversal and non-video storage paths", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "lectrallm-transcription-test-"),
    );
    temporaryRoots.push(workspaceRoot);
    const locator = createStoredVideoLocator({ workspaceRoot });

    await expect(
      locator.locate("storage/videos/../../.env", "lecture.mp4"),
    ).rejects.toBeInstanceOf(StoredVideoUnavailableError);
    await expect(
      locator.locate("storage/pdfs/notes.pdf", "lecture.mp4"),
    ).rejects.toBeInstanceOf(StoredVideoUnavailableError);
    await expect(
      locator.locate("C:\\Windows\\system.ini", "lecture.mp4"),
    ).rejects.toBeInstanceOf(StoredVideoUnavailableError);
  });
});
