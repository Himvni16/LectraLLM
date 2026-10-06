import type { AnalysisStatus } from "@prisma/client";

export interface TranscriptionAnalysis {
  id: string;
  videoFileName: string;
  pdfFileName: string;
  videoStoragePath: string;
  status: AnalysisStatus;
  transcriptText: string | null;
  transcriptionProviderFile: string | null;
}

export interface TranscriptionRepository {
  findById(id: string): Promise<TranscriptionAnalysis | null>;
  claim(id: string, leaseToken: string): Promise<boolean>;
  persistProviderFile(
    id: string,
    providerFile: string,
    leaseToken: string,
  ): Promise<boolean>;
  clearProviderFile(
    id: string,
    providerFile: string,
    leaseToken: string,
  ): Promise<boolean>;
  complete(
    id: string,
    providerFile: string,
    transcriptText: string,
    leaseToken: string,
  ): Promise<boolean>;
  fail(
    id: string,
    leaseToken: string,
    clearProviderFile: boolean,
  ): Promise<boolean>;
}

export interface CloudinaryLocatedVideo {
  publicId: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface LocalLocatedVideo {
  absolutePath: string;
  fileName: string;
}

export type LocatedVideo = CloudinaryLocatedVideo | LocalLocatedVideo;

export interface VideoLocator {
  locate(storagePath: string, originalFileName: string): Promise<LocatedVideo>;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface AiTranscriptionResult {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  segments: TranscriptionSegment[];
  model: string;
}

export type TranscriptionProviderFileState =
  | "PROCESSING"
  | "ACTIVE"
  | "FAILED"
  | "NOT_FOUND";

export interface TranscriptionProviderFile {
  name: string;
  state: TranscriptionProviderFileState;
  uri: string | null;
  mimeType: string | null;
}

export interface TranscriptionClient {
  upload(video: LocatedVideo): Promise<TranscriptionProviderFile>;
  getFile(name: string): Promise<TranscriptionProviderFile>;
  generate(file: TranscriptionProviderFile): Promise<AiTranscriptionResult>;
  deleteFile(name: string): Promise<void>;
}

export interface TranscriptionStepResponse {
  analysisId: string;
  status: AnalysisStatus;
  videoFileName: string;
  pdfFileName: string;
  outcome:
    | "UPLOADED"
    | "PROCESSING"
    | "RETRYABLE"
    | "PROVIDER_EXPIRED"
    | "COMPLETED";
  transcription?: AiTranscriptionResult;
}
