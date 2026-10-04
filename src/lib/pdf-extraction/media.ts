import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import type { LocatedPdf, PdfLocator } from "@/lib/pdf-extraction/types";
import { getUploadLimits } from "@/lib/env";
import {
  createSupabasePdfStore,
  type SupabasePdfStore,
} from "@/lib/supabase/pdfs";

export class StoredPdfUnavailableError extends Error {
  constructor() {
    super("The stored lecture PDF is unavailable.");
    this.name = "StoredPdfUnavailableError";
  }
}

const SUPABASE_PDF_PATH_PATTERN =
  /^analyses\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/document\.pdf$/;

interface SupabasePdfLocatorOptions {
  pdfStore?: Pick<SupabasePdfStore, "inspect">;
  maxSizeBytes?: number;
}

export function createSupabasePdfLocator(
  options: SupabasePdfLocatorOptions = {},
): PdfLocator {
  const pdfStore = options.pdfStore ?? createSupabasePdfStore();

  return {
    async locate(storagePath, originalFileName): Promise<LocatedPdf> {
      if (!SUPABASE_PDF_PATH_PATTERN.test(storagePath)) {
        throw new StoredPdfUnavailableError();
      }

      try {
        const metadata = await pdfStore.inspect(storagePath);
        const maxSizeBytes =
          options.maxSizeBytes ?? getUploadLimits().pdfMaxSizeBytes;
        if (
          metadata.size <= 0 ||
          metadata.size > maxSizeBytes ||
          metadata.contentType !== "application/pdf"
        ) {
          throw new StoredPdfUnavailableError();
        }

        return {
          objectPath: storagePath,
          fileName: path.basename(originalFileName),
          contentType: metadata.contentType,
          size: metadata.size,
        };
      } catch {
        throw new StoredPdfUnavailableError();
      }
    },
  };
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
