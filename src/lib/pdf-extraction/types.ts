import type { AnalysisStatus } from "@prisma/client";

export interface PdfExtractionAnalysis {
  id: string;
  videoFileName: string;
  pdfFileName: string;
  pdfStoragePath: string;
  status: AnalysisStatus;
  transcriptText: string | null;
  pdfText: string | null;
}

export interface PdfExtractionRepository {
  findById(id: string): Promise<PdfExtractionAnalysis | null>;
  claim(id: string): Promise<boolean>;
  complete(id: string, pdfText: string): Promise<boolean>;
  fail(id: string): Promise<void>;
}

export interface LocatedPdf {
  absolutePath: string;
  fileName: string;
}

export interface PdfLocator {
  locate(storagePath: string, originalFileName: string): Promise<LocatedPdf>;
}

export interface AiPdfExtractionResult {
  text: string;
  pageCount: number;
  characterCount: number;
}

export class PdfExtractionClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfExtractionClientError";
  }
}

export interface PdfExtractionClient {
  extract(pdf: LocatedPdf): Promise<AiPdfExtractionResult>;
}

export interface PdfExtractionSuccessResponse extends AiPdfExtractionResult {
  analysisId: string;
  status: AnalysisStatus;
  videoFileName: string;
  pdfFileName: string;
}
