import { AnalysisStatus, TopicSource } from "@prisma/client";

export type AnalysisPipelineStage =
  | "transcription"
  | "pdf-extraction"
  | "topic-extraction"
  | "comparison"
  | "completed";

export interface AnalysisResumeSnapshot {
  id: string;
  status: AnalysisStatus;
  transcriptText: string | null;
  pdfText: string | null;
  hasOverallSimilarityScore: boolean;
  topics: Array<{ id: string; source: TopicSource }>;
  topicMatches: Array<{ pdfTopicId: string }>;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function hasCompleteTopics(
  analysis: AnalysisResumeSnapshot,
): boolean {
  const hasVideoTopics = analysis.topics.some(
    (topic) => topic.source === TopicSource.VIDEO,
  );
  const hasPdfTopics = analysis.topics.some(
    (topic) => topic.source === TopicSource.PDF,
  );

  return hasVideoTopics && hasPdfTopics;
}

function hasCompleteComparison(analysis: AnalysisResumeSnapshot): boolean {
  if (!analysis.hasOverallSimilarityScore) return false;
  const pdfTopicIds = analysis.topics
    .filter((topic) => topic.source === TopicSource.PDF)
    .map((topic) => topic.id);
  const matchedPdfTopicIds = new Set(
    analysis.topicMatches.map((match) => match.pdfTopicId),
  );
  return (
    pdfTopicIds.length > 0 &&
    analysis.topicMatches.length === pdfTopicIds.length &&
    matchedPdfTopicIds.size === pdfTopicIds.length &&
    pdfTopicIds.every((id) => matchedPdfTopicIds.has(id))
  );
}

export function determineResumeStage(
  analysis: AnalysisResumeSnapshot,
): AnalysisPipelineStage {
  if (analysis.status === AnalysisStatus.COMPLETED) return "completed";
  if (!hasText(analysis.transcriptText)) return "transcription";
  if (!hasText(analysis.pdfText)) return "pdf-extraction";
  if (!hasCompleteTopics(analysis)) return "topic-extraction";
  return hasCompleteComparison(analysis) ? "completed" : "comparison";
}

const STATUS_STAGE: Partial<Record<AnalysisStatus, AnalysisPipelineStage>> = {
  [AnalysisStatus.UPLOADED]: "transcription",
  [AnalysisStatus.TRANSCRIBING]: "transcription",
  [AnalysisStatus.EXTRACTING_PDF]: "pdf-extraction",
  [AnalysisStatus.EXTRACTING_TOPICS]: "topic-extraction",
  [AnalysisStatus.COMPARING]: "comparison",
};

const STAGE_INDEX: Record<AnalysisPipelineStage, number> = {
  transcription: 0,
  "pdf-extraction": 1,
  "topic-extraction": 2,
  comparison: 3,
  completed: 4,
};

export type AnalysisRunAction =
  | { type: "run"; stage: Exclude<AnalysisPipelineStage, "completed"> }
  | { type: "advance"; status: AnalysisStatus }
  | { type: "completed" };

export function statusForStage(
  stage: Exclude<AnalysisPipelineStage, "completed">,
): AnalysisStatus {
  if (stage === "transcription") return AnalysisStatus.UPLOADED;
  if (stage === "pdf-extraction") return AnalysisStatus.EXTRACTING_PDF;
  if (stage === "topic-extraction") return AnalysisStatus.EXTRACTING_TOPICS;
  return AnalysisStatus.COMPARING;
}

export function determineRunAction(
  analysis: AnalysisResumeSnapshot,
): AnalysisRunAction {
  if (analysis.status === AnalysisStatus.COMPLETED) return { type: "completed" };

  const resumeStage = determineResumeStage(analysis);
  if (resumeStage === "completed") {
    return { type: "advance", status: AnalysisStatus.COMPLETED };
  }

  if (analysis.status === AnalysisStatus.FAILED) {
    return { type: "run", stage: resumeStage };
  }

  const statusStage = STATUS_STAGE[analysis.status];
  if (
    statusStage &&
    STAGE_INDEX[resumeStage] > STAGE_INDEX[statusStage]
  ) {
    return { type: "advance", status: statusForStage(resumeStage) };
  }

  return { type: "run", stage: resumeStage };
}
