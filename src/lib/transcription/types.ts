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
  claim(id: string): Promise<boolean>;
  complete(id: string, transcriptText: string): Promise<boolean>;
  fail(id: string): Promise<void>;
}

export interface LocatedVideo {
  absolutePath: string;
  fileName: string;
}

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
