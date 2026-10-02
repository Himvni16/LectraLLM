import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import type { LocatedPdf, PdfLocator } from "@/lib/pdf-extraction/types";

export class StoredPdfUnavailableError extends Error {
  constructor() {
    super("The stored lecture PDF is unavailable.");
    this.name = "StoredPdfUnavailableError";
  }
}

interface StoredPdfLocatorOptions {
  workspaceRoot?: string;
  storageRoot?: string;
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createStoredPdfLocator(
  options: StoredPdfLocatorOptions = {},
): PdfLocator {
  const workspaceRoot = path.resolve(
    /* turbopackIgnore: true */
    options.workspaceRoot ?? process.cwd(),
  );
  const storageRoot = path.resolve(
    /* turbopackIgnore: true */
    options.storageRoot ?? path.join(workspaceRoot, "storage"),
  );
  const pdfsRoot = path.resolve(storageRoot, "pdfs");

  return {
    async locate(storagePath, originalFileName): Promise<LocatedPdf> {
      if (path.isAbsolute(storagePath)) {
        throw new StoredPdfUnavailableError();
      }

      const normalizedStoragePath = storagePath.replaceAll("/", path.sep);
      const absolutePath = path.resolve(workspaceRoot, normalizedStoragePath);

      if (
        !isWithinDirectory(pdfsRoot, absolutePath) ||
        path.extname(absolutePath).toLowerCase() !== ".pdf"
      ) {
        throw new StoredPdfUnavailableError();
      }

      try {
        const fileStats = await stat(absolutePath);
        if (!fileStats.isFile()) {
          throw new StoredPdfUnavailableError();
        }
      } catch {
        throw new StoredPdfUnavailableError();
      }

      return {
        absolutePath,
        fileName: path.basename(originalFileName),
      };
    },
  };
}
