import type { AnalysisStatus, TopicSource } from "@prisma/client";

export interface TopicExtractionAnalysis {
  id: string;
  status: AnalysisStatus;
  transcriptText: string | null;
  pdfText: string | null;
}

export interface ExtractedTopic {
  name: string;
  confidence: number | null;
}

export interface AiTopicExtractionResult {
  topics: ExtractedTopic[];
}

export class TopicExtractionClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TopicExtractionClientError";
  }
}

export interface TopicExtractionClient {
  extract(text: string, source: TopicSource): Promise<AiTopicExtractionResult>;
}

export interface TopicExtractionRepository {
  findById(id: string): Promise<TopicExtractionAnalysis | null>;
  claim(id: string, leaseToken: string): Promise<boolean>;
  replaceAndComplete(
    id: string,
    videoTopics: readonly ExtractedTopic[],
    pdfTopics: readonly ExtractedTopic[],
    leaseToken: string,
  ): Promise<boolean>;
  fail(id: string, leaseToken: string): Promise<void>;
}

export interface TopicExtractionSuccessResponse {
  analysisId: string;
  status: AnalysisStatus;
  videoTopics: ExtractedTopic[];
  pdfTopics: ExtractedTopic[];
}
