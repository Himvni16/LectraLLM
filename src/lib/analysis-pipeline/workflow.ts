import "server-only";

import { AnalysisStatus } from "@prisma/client";

import { createSingleFlightRunner } from "@/lib/analysis-pipeline/concurrency";
import {
  determineResumeStage,
  type AnalysisPipelineStage,
  type AnalysisResumeSnapshot,
} from "@/lib/analysis-pipeline/resume";
import { createPdfExtractionClient } from "@/lib/pdf-extraction/client";
import { createSupabasePdfLocator } from "@/lib/pdf-extraction/media";
import { prismaPdfExtractionRepository } from "@/lib/pdf-extraction/repository";
import { extractAnalysisPdf } from "@/lib/pdf-extraction/workflow";
import { createGeminiTopicComparisonClient } from "@/lib/topic-comparison/gemini-client";
import { prismaTopicComparisonRepository } from "@/lib/topic-comparison/repository";
import { compareAnalysisTopics } from "@/lib/topic-comparison/workflow";
import { createGeminiTopicExtractionClient } from "@/lib/topic-extraction/gemini-client";
import { prismaTopicExtractionRepository } from "@/lib/topic-extraction/repository";
import { extractAnalysisTopics } from "@/lib/topic-extraction/workflow";
import { createAiTranscriptionClient } from "@/lib/transcription/ai-client";
import { createCloudinaryVideoLocator } from "@/lib/transcription/media";
import { prismaTranscriptionRepository } from "@/lib/transcription/repository";
import { transcribeAnalysis } from "@/lib/transcription/workflow";

export interface AnalysisPipelineRepository {
  findById(id: string): Promise<AnalysisResumeSnapshot | null>;
  releaseInterruptedTranscription(id: string): Promise<boolean>;
}

export interface AnalysisPipelineDependencies {
  repository: AnalysisPipelineRepository;
  transcribe(id: string): Promise<unknown>;
  extractPdf(id: string): Promise<unknown>;
  extractTopics(id: string): Promise<unknown>;
  compareTopics(id: string): Promise<unknown>;
}

export class AnalysisPipelineError extends Error {
  constructor(
    public readonly code: "ANALYSIS_NOT_FOUND" | "PIPELINE_CONFLICT",
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AnalysisPipelineError";
  }
}

const STAGES: readonly Exclude<AnalysisPipelineStage, "completed">[] = [
  "transcription",
  "pdf-extraction",
  "topic-extraction",
  "comparison",
];

export async function executeAnalysisPipeline(
  analysisId: string,
  dependencies: AnalysisPipelineDependencies,
): Promise<{
  analysisId: string;
  status: typeof AnalysisStatus.COMPLETED;
}> {
  let analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new AnalysisPipelineError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  const resumeStage = determineResumeStage(analysis);
  if (resumeStage === "completed") {
    return { analysisId, status: AnalysisStatus.COMPLETED };
  }

  if (
    resumeStage === "transcription" &&
    analysis.status === AnalysisStatus.TRANSCRIBING
  ) {
    const released =
      await dependencies.repository.releaseInterruptedTranscription(analysisId);

    if (!released) {
      analysis = await dependencies.repository.findById(analysisId);
      if (analysis?.status === AnalysisStatus.COMPLETED) {
        return { analysisId, status: AnalysisStatus.COMPLETED };
      }

      throw new AnalysisPipelineError(
        "PIPELINE_CONFLICT",
        "The analysis is already being processed.",
        409,
      );
    }
  }

  const firstStageIndex = STAGES.indexOf(resumeStage);

  for (const stage of STAGES.slice(firstStageIndex)) {
    if (stage === "transcription") await dependencies.transcribe(analysisId);
    if (stage === "pdf-extraction") await dependencies.extractPdf(analysisId);
    if (stage === "topic-extraction") await dependencies.extractTopics(analysisId);
    if (stage === "comparison") await dependencies.compareTopics(analysisId);
  }

  return { analysisId, status: AnalysisStatus.COMPLETED };
}

const productionDependencies: AnalysisPipelineDependencies = {
  repository: undefined as never,
  transcribe: (id) =>
    transcribeAnalysis(id, {
      client: createAiTranscriptionClient(),
      repository: prismaTranscriptionRepository,
      videoLocator: createCloudinaryVideoLocator(),
    }),
  extractPdf: (id) =>
    extractAnalysisPdf(id, {
      client: createPdfExtractionClient(),
      repository: prismaPdfExtractionRepository,
      pdfLocator: createSupabasePdfLocator(),
    }),
  extractTopics: (id) =>
    extractAnalysisTopics(id, {
      client: createGeminiTopicExtractionClient(),
      repository: prismaTopicExtractionRepository,
    }),
  compareTopics: (id) =>
    compareAnalysisTopics(id, {
      client: createGeminiTopicComparisonClient(),
      repository: prismaTopicComparisonRepository,
    }),
};

async function runProductionPipeline(analysisId: string) {
  const { prismaAnalysisPipelineRepository } = await import(
    "@/lib/analysis-pipeline/repository"
  );

  return executeAnalysisPipeline(analysisId, {
    ...productionDependencies,
    repository: prismaAnalysisPipelineRepository,
  });
}

const globalForPipeline = globalThis as typeof globalThis & {
  lectraPipelineRunner?: (
    analysisId: string,
  ) => ReturnType<typeof runProductionPipeline>;
};

export const runAnalysisPipeline =
  globalForPipeline.lectraPipelineRunner ??
  createSingleFlightRunner(runProductionPipeline);

if (process.env.NODE_ENV !== "production") {
  globalForPipeline.lectraPipelineRunner = runAnalysisPipeline;
}
