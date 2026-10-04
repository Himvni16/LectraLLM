import "server-only";

import { readFile, stat } from "node:fs/promises";

import { extractText } from "unpdf";

import { getUploadLimits } from "@/lib/env";
import {
  PdfExtractionClientError,
  type AiPdfExtractionResult,
  type PdfExtractionClient,
} from "@/lib/pdf-extraction/types";

interface PdfExtractionClientOptions {
  maxSizeBytes?: number;
}

export function normalizeExtractedText(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const cleanedLines: string[] = [];

  for (const line of normalized.split("\n")) {
    const cleanedLine = line.replace(/[\t\f\v ]+/g, " ").trim();

    if (cleanedLine) {
      cleanedLines.push(cleanedLine);
    } else if (cleanedLines.length > 0 && cleanedLines.at(-1) !== "") {
      cleanedLines.push("");
    }
  }

  return cleanedLines.join("\n").trim();
}

export function createPdfExtractionClient(
  options: PdfExtractionClientOptions = {},
): PdfExtractionClient {
  return {
    async extract(pdf): Promise<AiPdfExtractionResult> {
      const maxSizeBytes =
        options.maxSizeBytes ?? getUploadLimits().pdfMaxSizeBytes;

      let contents: Buffer;

      try {
        const fileStats = await stat(pdf.absolutePath);
        if (!fileStats.isFile()) {
          throw new Error("Stored PDF path is not a file.");
        }
        if (fileStats.size === 0) {
          throw new PdfExtractionClientError(
            "No extractable text found in PDF.",
          );
        }
        if (fileStats.size > maxSizeBytes) {
          throw new PdfExtractionClientError(
            "The PDF text could not be extracted.",
          );
        }

        contents = await readFile(pdf.absolutePath);
        if (contents.byteLength > maxSizeBytes) {
          throw new PdfExtractionClientError(
            "The PDF text could not be extracted.",
          );
        }
      } catch (error) {
        if (error instanceof PdfExtractionClientError) {
          throw error;
        }

        throw new PdfExtractionClientError("PDF could not be read.", {
          cause: error,
        });
      }

      try {
        const result = await extractText(new Uint8Array(contents), {
          mergePages: false,
        });
        const pageTexts = result.text
          .map(normalizeExtractedText)
          .filter((pageText) => pageText.length > 0);
        const text = pageTexts.join("\n\n").trim();

        if (!text) {
          throw new PdfExtractionClientError(
            "No extractable text found in PDF.",
          );
        }

        return {
          text,
          pageCount: result.totalPages,
          characterCount: text.length,
        };
      } catch (error) {
        if (error instanceof PdfExtractionClientError) {
          throw error;
        }

        throw new PdfExtractionClientError("PDF could not be read.", {
          cause: error,
        });
      }
    },
  };
}
