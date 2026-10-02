import "server-only";

import { readFile } from "node:fs/promises";

import { getAiServiceUrl, getAiTranscriptionTimeoutMs } from "@/lib/env";
import {
  PdfExtractionClientError,
  type AiPdfExtractionResult,
  type LocatedPdf,
  type PdfExtractionClient,
} from "@/lib/pdf-extraction/types";

const SAFE_SERVICE_ERRORS = new Set([
  "No extractable text found in PDF.",
  "PDF could not be read.",
]);

function isPdfExtractionResult(
  value: unknown,
): value is AiPdfExtractionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<AiPdfExtractionResult>;
  return (
    typeof result.text === "string" &&
    result.text.trim().length > 0 &&
    Number.isInteger(result.pageCount) &&
    (result.pageCount ?? 0) > 0 &&
    Number.isInteger(result.characterCount) &&
    (result.characterCount ?? -1) >= 0
  );
}

export function createAiPdfExtractionClient(): PdfExtractionClient {
  return {
    async extract(pdf: LocatedPdf): Promise<AiPdfExtractionResult> {
      const contents = await readFile(pdf.absolutePath);
      const formData = new FormData();
      formData.append(
        "pdf",
        new Blob([new Uint8Array(contents)], { type: "application/pdf" }),
        pdf.fileName,
      );

      const response = await fetch(`${getAiServiceUrl()}/extract-pdf`, {
        method: "POST",
        body: formData,
        cache: "no-store",
        signal: AbortSignal.timeout(getAiTranscriptionTimeoutMs()),
      });

      if (!response.ok) {
        let message = "The PDF text could not be extracted.";

        try {
          const payload: unknown = await response.json();
          if (payload && typeof payload === "object") {
            const detail = (payload as { detail?: unknown }).detail;
            if (typeof detail === "string" && SAFE_SERVICE_ERRORS.has(detail)) {
              message = detail;
            }
          }
        } catch {
          // Keep the sanitized fallback when the service response is not JSON.
        }

        throw new PdfExtractionClientError(message);
      }

      const result: unknown = await response.json();

      if (!isPdfExtractionResult(result)) {
        throw new Error("AI PDF extraction service returned an invalid response.");
      }

      const text = result.text.trim();
      return { ...result, text, characterCount: text.length };
    },
  };
}
