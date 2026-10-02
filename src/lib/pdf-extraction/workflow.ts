import { AnalysisStatus } from "@prisma/client";

import {
  PdfExtractionClientError,
  type PdfExtractionClient,
  type PdfExtractionRepository,
  type PdfExtractionSuccessResponse,
  type PdfLocator,
} from "@/lib/pdf-extraction/types";

export type PdfExtractionWorkflowErrorCode =
  | "ANALYSIS_NOT_FOUND"
  | "PDF_EXTRACTION_NOT_ALLOWED"
  | "PDF_UNAVAILABLE"
  | "PDF_EXTRACTION_FAILED";

export class PdfExtractionWorkflowError extends Error {
  constructor(
    public readonly code: PdfExtractionWorkflowErrorCode,
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PdfExtractionWorkflowError";
  }
}

interface PdfExtractionWorkflowDependencies {
  client: PdfExtractionClient;
  repository: PdfExtractionRepository;
  pdfLocator: PdfLocator;
}

export async function extractAnalysisPdf(
  analysisId: string,
  dependencies: PdfExtractionWorkflowDependencies,
): Promise<PdfExtractionSuccessResponse> {
  const analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new PdfExtractionWorkflowError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  if (
    (analysis.status !== AnalysisStatus.EXTRACTING_PDF &&
      analysis.status !== AnalysisStatus.FAILED) ||
    !analysis.transcriptText?.trim()
  ) {
    throw new PdfExtractionWorkflowError(
      "PDF_EXTRACTION_NOT_ALLOWED",
      "PDF extraction is not allowed from the current analysis state.",
      409,
    );
  }

  let pdf;

  try {
    pdf = await dependencies.pdfLocator.locate(
      analysis.pdfStoragePath,
      analysis.pdfFileName,
    );
  } catch (error) {
    await dependencies.repository.fail(analysis.id);
    throw new PdfExtractionWorkflowError(
      "PDF_UNAVAILABLE",
      "The stored lecture PDF is unavailable.",
      409,
      { cause: error },
    );
  }

  const claimed = await dependencies.repository.claim(analysis.id);

  if (!claimed) {
    throw new PdfExtractionWorkflowError(
      "PDF_EXTRACTION_NOT_ALLOWED",
      "The analysis state changed before PDF extraction could start.",
      409,
    );
  }

  try {
    const extraction = await dependencies.client.extract(pdf);
    const pdfText = extraction.text.trim();

    if (!pdfText) {
      throw new Error("The PDF extraction service returned empty text.");
    }

    const completed = await dependencies.repository.complete(analysis.id, pdfText);

    if (!completed) {
      throw new Error("The analysis state changed during PDF extraction.");
    }

    return {
      ...extraction,
      text: pdfText,
      characterCount: pdfText.length,
      analysisId: analysis.id,
      status: AnalysisStatus.EXTRACTING_TOPICS,
      videoFileName: analysis.videoFileName,
      pdfFileName: analysis.pdfFileName,
    };
  } catch (error) {
    await dependencies.repository.fail(analysis.id);
    const message =
      error instanceof PdfExtractionClientError
        ? error.message
        : "The PDF text could not be extracted. You can retry this analysis.";
    throw new PdfExtractionWorkflowError(
      "PDF_EXTRACTION_FAILED",
      message,
      502,
      { cause: error },
    );
  }
}
