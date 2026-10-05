import type {
  AnalysisStatus,
  MatchType,
  Prisma,
  TopicSource,
} from "@prisma/client";

export interface ComparisonTopic {
  id: string;
  name: string;
}

export interface ComparisonAnalysisTopic extends ComparisonTopic {
  source: TopicSource;
}

export interface TopicComparisonAnalysis {
  id: string;
  status: AnalysisStatus;
  topics: ComparisonAnalysisTopic[];
}

export interface AiTopicComparisonMatch {
  pdfTopicId: string;
  videoTopicId: string | null;
  similarityScore: number;
  matchType: MatchType;
}

export interface AiTopicComparisonResult {
  matches: AiTopicComparisonMatch[];
}

export class TopicComparisonClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TopicComparisonClientError";
  }
}

export interface TopicComparisonClient {
  compare(
    videoTopics: readonly ComparisonTopic[],
    pdfTopics: readonly ComparisonTopic[],
  ): Promise<AiTopicComparisonResult>;
}

export interface TopicComparisonRepository {
  findById(id: string): Promise<TopicComparisonAnalysis | null>;
  claim(id: string, leaseToken: string): Promise<boolean>;
  replaceAndComplete(
    id: string,
    matches: readonly AiTopicComparisonMatch[],
    overallSimilarityScore: Prisma.Decimal,
    leaseToken: string,
  ): Promise<boolean>;
  fail(id: string, leaseToken: string): Promise<void>;
}

export interface TopicComparisonView {
  pdfTopicId: string;
  pdfTopicName: string;
  videoTopicId: string | null;
  videoTopicName: string | null;
  similarityScore: number;
  matchType: MatchType;
}

export interface TopicComparisonSuccessResponse {
  analysisId: string;
  status: AnalysisStatus;
  overallSimilarityScore: number;
  matches: TopicComparisonView[];
}
