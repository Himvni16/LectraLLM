import type { AnalysisStatus } from "@prisma/client";

export type UploadKind = "video" | "pdf";

export interface StoredUpload {
  storagePath: string;
  cleanupPath: string;
}

export interface UploadStorage {
  save(file: File, kind: UploadKind, extension: string): Promise<StoredUpload>;
  remove(file: StoredUpload): Promise<void>;
}

export interface UploadedAnalysisData {
  videoFileName: string;
  pdfFileName: string;
  videoStoragePath: string;
  pdfStoragePath: string;
  status: AnalysisStatus;
  transcriptText: null;
  pdfText: null;
  overallSimilarityScore: null;
}

export interface CreatedAnalysis {
  id: string;
  status: AnalysisStatus;
  videoFileName: string;
  pdfFileName: string;
}

export interface AnalysisRepository {
  createUploaded(data: UploadedAnalysisData): Promise<CreatedAnalysis>;
}

export interface UploadSuccessResponse {
  analysisId: string;
  status: AnalysisStatus;
  videoFileName: string;
  pdfFileName: string;
}
