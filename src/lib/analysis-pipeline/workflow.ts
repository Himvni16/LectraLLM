import "server-only";

import { AnalysisStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createSingleFlightRunner } from "@/lib/analysis-pipeline/concurrency";
import {
  determineRunAction,
  statusForStage,
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
import { createGeminiTranscriptionClient } from "@/lib/transcription/gemini-client";
import { createCloudinaryVideoLocator } from "@/lib/transcription/media";
import { prismaTranscriptionRepository } from "@/lib/transcription/repository";
import { transcribeAnalysis } from "@/lib/transcription/workflow";

export interface AnalysisPipelineRepository {
  findById(id: string): Promise<AnalysisResumeSnapshot | null>;
  claimLease(input: {
    id: string;
    expectedStatus: AnalysisStatus;
    claimedStatus: AnalysisStatus;
    token: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  advanceWithLease(
    id: string,
    token: string,
    status: AnalysisStatus,
    now: Date,
  ): Promise<boolean>;
  releaseLease(id: string, token: string): Promise<boolean>;
}

export interface AnalysisPipelineDependencies {
  repository: AnalysisPipelineRepository;
  transcribe(id: string, leaseToken: string): Promise<unknown>;
  extractPdf(id: string, leaseToken: string): Promise<unknown>;
  extractTopics(id: string, leaseToken: string): Promise<unknown>;
  compareTopics(id: string, leaseToken: string): Promise<unknown>;
  createToken?: () => string;
  now?: () => Date;
  leaseDurationMs?: number;
}

export interface AnalysisRunResponse {
  analysisId: string;
  status: AnalysisStatus;
  workPerformed: boolean;
  requiresAnotherRun: boolean;
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

export const ANALYSIS_LEASE_DURATION_MS = 6 * 60 * 1_000;

function responseFor(
  analysisId: string,
  status: AnalysisStatus,
  workPerformed: boolean,
): AnalysisRunResponse {
  return {
    analysisId,
    status,
    workPerformed,
    requiresAnotherRun:
      status !== AnalysisStatus.COMPLETED && status !== AnalysisStatus.FAILED,
  };
}

async function currentResponse(
  analysisId: string,
  dependencies: AnalysisPipelineDependencies,
  workPerformed: boolean,
): Promise<AnalysisRunResponse> {
  const current = await dependencies.repository.findById(analysisId);
  if (!current) {
    throw new AnalysisPipelineError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }
  return responseFor(analysisId, current.status, workPerformed);
}

async function executeStage(
  analysisId: string,
  leaseToken: string,
  stage: Exclude<AnalysisPipelineStage, "completed">,
  dependencies: AnalysisPipelineDependencies,
): Promise<void> {
  if (stage === "transcription") {
    await dependencies.transcribe(analysisId, leaseToken);
  } else if (stage === "pdf-extraction") {
    await dependencies.extractPdf(analysisId, leaseToken);
  } else if (stage === "topic-extraction") {
    await dependencies.extractTopics(analysisId, leaseToken);
  } else {
    await dependencies.compareTopics(analysisId, leaseToken);
  }
}

export async function executeAnalysisPipeline(
  analysisId: string,
  dependencies: AnalysisPipelineDependencies,
): Promise<AnalysisRunResponse> {
  const analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new AnalysisPipelineError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  const action = determineRunAction(analysis);
  if (action.type === "completed") {
    return responseFor(analysisId, AnalysisStatus.COMPLETED, false);
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const leaseToken = (dependencies.createToken ?? randomUUID)();
  const expiresAt = new Date(
    now.getTime() +
      (dependencies.leaseDurationMs ?? ANALYSIS_LEASE_DURATION_MS),
  );
  const claimedStatus =
    action.type === "run" ? statusForStage(action.stage) : analysis.status;
  const claimed = await dependencies.repository.claimLease({
    id: analysisId,
    expectedStatus: analysis.status,
    claimedStatus,
    token: leaseToken,
    now,
    expiresAt,
  });

  if (!claimed) {
    return currentResponse(analysisId, dependencies, false);
  }

  try {
    if (action.type === "advance") {
      const advanced = await dependencies.repository.advanceWithLease(
        analysisId,
        leaseToken,
        action.status,
        (dependencies.now ?? (() => new Date()))(),
      );
      if (!advanced) return currentResponse(analysisId, dependencies, false);
    } else {
      await executeStage(analysisId, leaseToken, action.stage, dependencies);
    }

    return currentResponse(analysisId, dependencies, true);
  } finally {
    await dependencies.repository.releaseLease(analysisId, leaseToken);
  }
}

const productionDependencies: AnalysisPipelineDependencies = {
  repository: undefined as never,
  transcribe: (id, leaseToken) =>
    transcribeAnalysis(id, {
      client: createGeminiTranscriptionClient(),
      leaseToken,
      repository: prismaTranscriptionRepository,
      videoLocator: createCloudinaryVideoLocator(),
    }),
  extractPdf: (id, leaseToken) =>
    extractAnalysisPdf(id, {
      client: createPdfExtractionClient(),
      leaseToken,
      repository: prismaPdfExtractionRepository,
      pdfLocator: createSupabasePdfLocator(),
    }),
  extractTopics: (id, leaseToken) =>
    extractAnalysisTopics(id, {
      client: createGeminiTopicExtractionClient(),
      leaseToken,
      repository: prismaTopicExtractionRepository,
    }),
  compareTopics: (id, leaseToken) =>
    compareAnalysisTopics(id, {
      client: createGeminiTopicComparisonClient(),
      leaseToken,
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
