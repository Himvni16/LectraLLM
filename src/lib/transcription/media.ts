import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import type { LocatedVideo, VideoLocator } from "@/lib/transcription/types";

export class StoredVideoUnavailableError extends Error {
  constructor() {
    super("The stored lecture video is unavailable.");
    this.name = "StoredVideoUnavailableError";
  }
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
