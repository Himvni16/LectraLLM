import type { AnalysisStatus } from "@prisma/client";

export interface TranscriptionAnalysis {
  id: string;
  videoFileName: string;
  pdfFileName: string;
  videoStoragePath: string;
  status: AnalysisStatus;
  transcriptText: string | null;
}

export interface TranscriptionRepository {
  findById(id: string): Promise<TranscriptionAnalysis | null>;
  claim(id: string, leaseToken: string): Promise<boolean>;
  complete(
    id: string,
    transcriptText: string,
    leaseToken: string,
  ): Promise<boolean>;
  fail(id: string, leaseToken: string): Promise<void>;
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

export interface TranscriptionClient {
  transcribe(video: LocatedVideo): Promise<AiTranscriptionResult>;
}

export interface TranscriptionSuccessResponse extends AiTranscriptionResult {
  analysisId: string;
  status: AnalysisStatus;
  videoFileName: string;
  pdfFileName: string;
}
