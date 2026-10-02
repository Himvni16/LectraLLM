import { AnalysisStatus, TopicSource } from "@prisma/client";

import type {
  TopicExtractionClient,
  TopicExtractionRepository,
  TopicExtractionSuccessResponse,
} from "@/lib/topic-extraction/types";

export type TopicExtractionWorkflowErrorCode =
  | "ANALYSIS_NOT_FOUND"
  | "TOPIC_EXTRACTION_NOT_ALLOWED"
  | "TRANSCRIPT_REQUIRED"
  | "PDF_TEXT_REQUIRED"
  | "TOPIC_EXTRACTION_FAILED";

export class TopicExtractionWorkflowError extends Error {
  constructor(
    public readonly code: TopicExtractionWorkflowErrorCode,
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TopicExtractionWorkflowError";
  }
}

interface TopicExtractionWorkflowDependencies {
  client: TopicExtractionClient;
  repository: TopicExtractionRepository;
}

export async function extractAnalysisTopics(
  analysisId: string,
  dependencies: TopicExtractionWorkflowDependencies,
): Promise<TopicExtractionSuccessResponse> {
  const analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new TopicExtractionWorkflowError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  if (
    analysis.status !== AnalysisStatus.EXTRACTING_TOPICS &&
    analysis.status !== AnalysisStatus.FAILED
  ) {
    throw new TopicExtractionWorkflowError(
      "TOPIC_EXTRACTION_NOT_ALLOWED",
      "Topic extraction is not allowed from the current analysis state.",
      409,
    );
  }

  const transcriptText = analysis.transcriptText?.trim();
  if (!transcriptText) {
    throw new TopicExtractionWorkflowError(
      "TRANSCRIPT_REQUIRED",
      "A completed lecture transcript is required for topic extraction.",
      409,
    );
  }

  const pdfText = analysis.pdfText?.trim();
  if (!pdfText) {
    throw new TopicExtractionWorkflowError(
      "PDF_TEXT_REQUIRED",
      "Extracted PDF text is required for topic extraction.",
      409,
    );
  }

  const claimed = await dependencies.repository.claim(analysis.id);
  if (!claimed) {
    throw new TopicExtractionWorkflowError(
      "TOPIC_EXTRACTION_NOT_ALLOWED",
      "The analysis state changed before topic extraction could start.",
      409,
    );
  }

  try {
    const [videoResult, pdfResult] = await Promise.all([
      dependencies.client.extract(transcriptText, TopicSource.VIDEO),
      dependencies.client.extract(pdfText, TopicSource.PDF),
    ]);

    const completed = await dependencies.repository.replaceAndComplete(
      analysis.id,
      videoResult.topics,
      pdfResult.topics,
    );

    if (!completed) {
      throw new Error("The analysis state changed during topic extraction.");
    }

    return {
      analysisId: analysis.id,
      status: AnalysisStatus.COMPARING,
      videoTopics: videoResult.topics,
      pdfTopics: pdfResult.topics,
    };
  } catch (error) {
    await dependencies.repository.fail(analysis.id);
    throw new TopicExtractionWorkflowError(
      "TOPIC_EXTRACTION_FAILED",
      "Topics could not be extracted. You can retry this analysis.",
      502,
      { cause: error },
    );
  }
}
