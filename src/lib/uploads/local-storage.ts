import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { UploadStorage } from "@/lib/uploads/types";

interface LocalUploadStorageOptions {
  rootDirectory?: string;
  storagePathPrefix?: string;
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createLocalUploadStorage(
  options: LocalUploadStorageOptions = {},
): UploadStorage {
  const rootDirectory = path.resolve(
    /* turbopackIgnore: true */
    options.rootDirectory ?? path.join(process.cwd(), "storage"),
  );
  const storagePathPrefix = options.storagePathPrefix ?? "storage";

  return {
    async save(file, kind, extension) {
      const subdirectory = kind === "video" ? "videos" : "pdfs";
      const targetDirectory = path.resolve(rootDirectory, subdirectory);

      if (!isWithinDirectory(rootDirectory, targetDirectory)) {
        throw new Error("Resolved upload directory is outside the storage root.");
      }

      await mkdir(targetDirectory, { recursive: true });

      const storedFileName = `${randomUUID()}${extension}`;
      const cleanupPath = path.resolve(targetDirectory, storedFileName);

      if (!isWithinDirectory(rootDirectory, cleanupPath)) {
        throw new Error("Resolved upload file is outside the storage root.");
      }

      try {
        const contents = Buffer.from(await file.arrayBuffer());
        await writeFile(cleanupPath, contents, { flag: "wx" });
      } catch (error) {
        await rm(cleanupPath, { force: true });
        throw error;
      }

      return {
        cleanupPath,
        storagePath: path.posix.join(
          storagePathPrefix,
          subdirectory,
          storedFileName,
        ),
      };
    },

    async remove(file) {
      const cleanupPath = path.resolve(file.cleanupPath);

      if (!isWithinDirectory(rootDirectory, cleanupPath)) {
        throw new Error("Refusing to remove a file outside the storage root.");
      }

      await rm(cleanupPath, { force: true });
    },
  };
}
