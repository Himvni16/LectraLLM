import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import type { LocatedVideo, VideoLocator } from "@/lib/transcription/types";
import { getCloudinaryConfig, getUploadLimits } from "@/lib/env";
import {
  createCloudinaryVideoStore,
  type CloudinaryVideoStore,
} from "@/lib/cloudinary/videos";

export class StoredVideoUnavailableError extends Error {
  constructor() {
    super("The stored lecture video is unavailable.");
    this.name = "StoredVideoUnavailableError";
  }
}

const UUID_SUFFIX_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

interface CloudinaryVideoLocatorOptions {
  videoStore?: Pick<CloudinaryVideoStore, "inspect">;
  maxSizeBytes?: number;
  uploadFolder?: string;
}

export function createCloudinaryVideoLocator(
  options: CloudinaryVideoLocatorOptions = {},
): VideoLocator {
  const videoStore = options.videoStore ?? createCloudinaryVideoStore();
  const uploadFolder =
    options.uploadFolder ?? getCloudinaryConfig().uploadFolder;
  const publicIdPattern = new RegExp(
    `^${uploadFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${UUID_SUFFIX_PATTERN}$`,
  );

  return {
    async locate(storagePath, originalFileName): Promise<LocatedVideo> {
      if (!publicIdPattern.test(storagePath)) {
        throw new StoredVideoUnavailableError();
      }

      try {
        const metadata = await videoStore.inspect(storagePath);
        const maxSizeBytes =
          options.maxSizeBytes ?? getUploadLimits().videoMaxSizeBytes;
        if (
          metadata.bytes <= 0 ||
          metadata.bytes > maxSizeBytes ||
          metadata.resourceType !== "video" ||
          metadata.deliveryType !== "authenticated" ||
          !["mp4", "mov", "webm"].includes(metadata.format)
        ) {
          throw new StoredVideoUnavailableError();
        }

        return {
          publicId: storagePath,
          fileName: path.basename(originalFileName),
          contentType:
            metadata.format === "mov"
              ? "video/quicktime"
              : `video/${metadata.format}`,
          size: metadata.bytes,
        };
      } catch {
        throw new StoredVideoUnavailableError();
      }
    },
  };
}

interface StoredVideoLocatorOptions {
  workspaceRoot?: string;
  storageRoot?: string;
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createStoredVideoLocator(
  options: StoredVideoLocatorOptions = {},
): VideoLocator {
  const workspaceRoot = path.resolve(
    /* turbopackIgnore: true */
    options.workspaceRoot ?? process.cwd(),
  );
  const storageRoot = path.resolve(
    /* turbopackIgnore: true */
    options.storageRoot ?? path.join(workspaceRoot, "storage"),
  );
  const videosRoot = path.resolve(storageRoot, "videos");

  return {
    async locate(storagePath, originalFileName): Promise<LocatedVideo> {
      if (path.isAbsolute(storagePath)) {
        throw new StoredVideoUnavailableError();
      }

      const normalizedStoragePath = storagePath.replaceAll("/", path.sep);
      const absolutePath = path.resolve(workspaceRoot, normalizedStoragePath);

      if (!isWithinDirectory(videosRoot, absolutePath)) {
        throw new StoredVideoUnavailableError();
      }

      try {
        const fileStats = await stat(absolutePath);
        if (!fileStats.isFile()) {
          throw new StoredVideoUnavailableError();
        }
      } catch {
        throw new StoredVideoUnavailableError();
      }

      return {
        absolutePath,
        fileName: path.basename(originalFileName),
      };
    },
  };
}
