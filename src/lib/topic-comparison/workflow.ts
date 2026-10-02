import { AnalysisStatus, Prisma, TopicSource } from "@prisma/client";

import type {
  ComparisonTopic,
  TopicComparisonClient,
  TopicComparisonRepository,
  TopicComparisonSuccessResponse,
} from "@/lib/topic-comparison/types";

export type TopicComparisonWorkflowErrorCode =
  | "ANALYSIS_NOT_FOUND"
  | "COMPARISON_NOT_ALLOWED"
  | "VIDEO_TOPICS_REQUIRED"
  | "PDF_TOPICS_REQUIRED"
  | "COMPARISON_FAILED";

export class TopicComparisonWorkflowError extends Error {
  constructor(
    public readonly code: TopicComparisonWorkflowErrorCode,
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TopicComparisonWorkflowError";
  }
}

interface TopicComparisonWorkflowDependencies {
  client: TopicComparisonClient;
  repository: TopicComparisonRepository;
}

export async function compareAnalysisTopics(
  analysisId: string,
  dependencies: TopicComparisonWorkflowDependencies,
): Promise<TopicComparisonSuccessResponse> {
  const analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new TopicComparisonWorkflowError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  if (
    analysis.status !== AnalysisStatus.COMPARING &&
    analysis.status !== AnalysisStatus.FAILED
  ) {
    throw new TopicComparisonWorkflowError(
      "COMPARISON_NOT_ALLOWED",
      "Topic comparison is not allowed from the current analysis state.",
      409,
    );
  }

  const videoTopics: ComparisonTopic[] = analysis.topics
    .filter((topic) => topic.source === TopicSource.VIDEO)
    .map(({ id, name }) => ({ id, name }));
  const pdfTopics: ComparisonTopic[] = analysis.topics
    .filter((topic) => topic.source === TopicSource.PDF)
    .map(({ id, name }) => ({ id, name }));

  if (videoTopics.length === 0) {
    throw new TopicComparisonWorkflowError(
      "VIDEO_TOPICS_REQUIRED",
      "Extracted lecture topics are required for comparison.",
      409,
    );
  }

  if (pdfTopics.length === 0) {
    throw new TopicComparisonWorkflowError(
      "PDF_TOPICS_REQUIRED",
      "Extracted PDF topics are required for comparison.",
      409,
    );
  }

  const claimed = await dependencies.repository.claim(analysis.id);
  if (!claimed) {
    throw new TopicComparisonWorkflowError(
      "COMPARISON_NOT_ALLOWED",
      "The analysis state changed before comparison could start.",
      409,
    );
  }

  try {
    const result = await dependencies.client.compare(videoTopics, pdfTopics);
    const similarityTotal = result.matches.reduce(
      (total, match) => total.plus(match.similarityScore.toString()),
      new Prisma.Decimal(0),
    );
    const overallSimilarityScore = similarityTotal
      .dividedBy(pdfTopics.length)
      .times(100);

    const completed = await dependencies.repository.replaceAndComplete(
      analysis.id,
      result.matches,
      overallSimilarityScore,
    );
    if (!completed) {
      throw new Error("The analysis state changed during topic comparison.");
    }

    const topicById = new Map(
      analysis.topics.map((topic) => [topic.id, topic] as const),
    );

    return {
      analysisId: analysis.id,
      status: AnalysisStatus.COMPLETED,
      overallSimilarityScore: overallSimilarityScore.toNumber(),
      matches: result.matches.map((match) => ({
        ...match,
        pdfTopicName: topicById.get(match.pdfTopicId)?.name ?? "PDF topic",
        videoTopicName:
          match.videoTopicId === null
            ? null
            : (topicById.get(match.videoTopicId)?.name ?? "Lecture topic"),
      })),
    };
  } catch (error) {
    await dependencies.repository.fail(analysis.id);
    throw new TopicComparisonWorkflowError(
      "COMPARISON_FAILED",
      "Topics could not be compared. You can retry this analysis.",
      502,
      { cause: error },
    );
  }
}
