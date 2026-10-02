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
  topics: Array<{ source: TopicSource }>;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function determineFailedResumeStage(
  analysis: AnalysisResumeSnapshot,
): AnalysisPipelineStage {
  if (!hasText(analysis.transcriptText)) return "transcription";
  if (!hasText(analysis.pdfText)) return "pdf-extraction";

  const hasVideoTopics = analysis.topics.some(
    (topic) => topic.source === TopicSource.VIDEO,
  );
  const hasPdfTopics = analysis.topics.some(
    (topic) => topic.source === TopicSource.PDF,
  );

  return hasVideoTopics && hasPdfTopics ? "comparison" : "topic-extraction";
}

export function determineResumeStage(
  analysis: AnalysisResumeSnapshot,
): AnalysisPipelineStage {
  switch (analysis.status) {
    case AnalysisStatus.UPLOADED:
    case AnalysisStatus.TRANSCRIBING:
      return "transcription";
    case AnalysisStatus.EXTRACTING_PDF:
      return "pdf-extraction";
    case AnalysisStatus.EXTRACTING_TOPICS:
      return "topic-extraction";
    case AnalysisStatus.COMPARING:
      return "comparison";
    case AnalysisStatus.COMPLETED:
      return "completed";
    case AnalysisStatus.FAILED:
      return determineFailedResumeStage(analysis);
  }
}
