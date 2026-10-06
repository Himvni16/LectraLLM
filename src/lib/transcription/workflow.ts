import { AnalysisStatus } from "@prisma/client";

import {
  classifyTranscriptionError,
  type TranscriptionErrorCategory,
} from "@/lib/transcription/errors";
import type {
  TranscriptionClient,
  TranscriptionRepository,
  TranscriptionStepResponse,
  VideoLocator,
} from "@/lib/transcription/types";

export type TranscriptionWorkflowErrorCode =
  | "ANALYSIS_NOT_FOUND"
  | "TRANSCRIPTION_NOT_ALLOWED"
  | "VIDEO_UNAVAILABLE"
  | "TRANSCRIPTION_FAILED";

export class TranscriptionWorkflowError extends Error {
  constructor(
    public readonly code: TranscriptionWorkflowErrorCode,
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TranscriptionWorkflowError";
  }
}

interface TranscriptionWorkflowDependencies {
  client: TranscriptionClient;
  leaseToken: string;
  repository: TranscriptionRepository;
  videoLocator: VideoLocator;
  logger?: Pick<Console, "warn" | "error">;
  now?: () => number;
}

type TranscriptionOperation =
  | "video-location"
  | "provider-upload"
  | "provider-file-check"
  | "transcript-generation";

function logFailure(
  dependencies: TranscriptionWorkflowDependencies,
  input: {
    analysisId: string;
    category: TranscriptionErrorCategory;
    elapsedMs: number;
    operation: TranscriptionOperation;
    providerFilePresent: boolean;
    retryable: boolean;
  },
): void {
  const logger = dependencies.logger ?? console;
  const context = {
    analysisId: input.analysisId,
    stage: "transcription",
    operation: input.operation,
    retryable: input.retryable,
    category: input.category,
    providerFilePresent: input.providerFilePresent,
    elapsedMs: input.elapsedMs,
  };

  if (input.retryable) {
    logger.warn("Retryable transcription operation failed.", context);
  } else {
    logger.error("Terminal transcription operation failed.", context);
  }
}

async function bestEffortDelete(
  client: TranscriptionClient,
  providerFile: string,
): Promise<void> {
  try {
    await client.deleteFile(providerFile);
  } catch {
    // A saved transcript or ownership decision must survive cleanup failure.
  }
}

function response(
  analysis: {
    id: string;
    videoFileName: string;
    pdfFileName: string;
  },
  outcome: TranscriptionStepResponse["outcome"],
  status: AnalysisStatus = AnalysisStatus.TRANSCRIBING,
): TranscriptionStepResponse {
  return {
    analysisId: analysis.id,
    status,
    videoFileName: analysis.videoFileName,
    pdfFileName: analysis.pdfFileName,
    outcome,
  };
}

function ownershipLost(error?: unknown): TranscriptionWorkflowError {
  return new TranscriptionWorkflowError(
    "TRANSCRIPTION_NOT_ALLOWED",
    "The analysis lease changed during transcription.",
    409,
    error === undefined ? undefined : { cause: error },
  );
}

function providerFailure(error?: unknown): TranscriptionWorkflowError {
  return new TranscriptionWorkflowError(
    "TRANSCRIPTION_FAILED",
    "The lecture could not be transcribed. You can retry this analysis.",
    502,
    error === undefined ? undefined : { cause: error },
  );
}

export async function transcribeAnalysis(
  analysisId: string,
  dependencies: TranscriptionWorkflowDependencies,
): Promise<TranscriptionStepResponse> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const analysis = await dependencies.repository.findById(analysisId);

  if (!analysis) {
    throw new TranscriptionWorkflowError(
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
      404,
    );
  }

  if (
    analysis.status !== AnalysisStatus.UPLOADED &&
    analysis.status !== AnalysisStatus.TRANSCRIBING &&
    analysis.status !== AnalysisStatus.FAILED
  ) {
    throw new TranscriptionWorkflowError(
      "TRANSCRIPTION_NOT_ALLOWED",
      "Transcription is not allowed from the current analysis status.",
      409,
    );
  }

  const claimed = await dependencies.repository.claim(
    analysis.id,
    dependencies.leaseToken,
  );
  if (!claimed) throw ownershipLost();

  const persistedProviderFile = analysis.transcriptionProviderFile;
  if (!persistedProviderFile) {
    let video;
    try {
      video = await dependencies.videoLocator.locate(
        analysis.videoStoragePath,
        analysis.videoFileName,
      );
    } catch (error) {
      const classification = classifyTranscriptionError(error);
      logFailure(dependencies, {
        analysisId: analysis.id,
        category: classification.category,
        elapsedMs: Math.max(0, now() - startedAt),
        operation: "video-location",
        providerFilePresent: false,
        retryable: classification.retryable,
      });
      if (classification.retryable) {
        return response(analysis, "RETRYABLE");
      }
      const failed = await dependencies.repository.fail(
        analysis.id,
        dependencies.leaseToken,
        false,
      );
      if (!failed) throw ownershipLost(error);
      throw new TranscriptionWorkflowError(
        "VIDEO_UNAVAILABLE",
        "The stored lecture video is unavailable.",
        409,
        { cause: error },
      );
    }

    let uploadedFile;
    try {
      uploadedFile = await dependencies.client.upload(video);
    } catch (error) {
      const classification = classifyTranscriptionError(error);
      logFailure(dependencies, {
        analysisId: analysis.id,
        category: classification.category,
        elapsedMs: Math.max(0, now() - startedAt),
        operation: "provider-upload",
        providerFilePresent: false,
        retryable: classification.retryable,
      });
      if (classification.retryable) {
        return response(analysis, "RETRYABLE");
      }
      const failed = await dependencies.repository.fail(
        analysis.id,
        dependencies.leaseToken,
        false,
      );
      if (!failed) throw ownershipLost(error);
      throw providerFailure(error);
    }

    if (uploadedFile.state === "FAILED") {
      logFailure(dependencies, {
        analysisId: analysis.id,
        category: "PROVIDER_FILE_FAILED",
        elapsedMs: Math.max(0, now() - startedAt),
        operation: "provider-upload",
        providerFilePresent: true,
        retryable: false,
      });
      const failed = await dependencies.repository.fail(
        analysis.id,
        dependencies.leaseToken,
        false,
      );
      await bestEffortDelete(dependencies.client, uploadedFile.name);
      if (!failed) throw ownershipLost();
      throw providerFailure();
    }

    const persisted = await dependencies.repository.persistProviderFile(
      analysis.id,
      uploadedFile.name,
      dependencies.leaseToken,
    );
    if (!persisted) {
      await bestEffortDelete(dependencies.client, uploadedFile.name);
      throw ownershipLost();
    }

    return response(analysis, "UPLOADED");
  }

  let providerFile;
  try {
    providerFile = await dependencies.client.getFile(persistedProviderFile);
  } catch (error) {
    const classification = classifyTranscriptionError(error);
    logFailure(dependencies, {
      analysisId: analysis.id,
      category: classification.category,
      elapsedMs: Math.max(0, now() - startedAt),
      operation: "provider-file-check",
      providerFilePresent: true,
      retryable: classification.retryable,
    });
    if (classification.retryable) {
      return response(analysis, "RETRYABLE");
    }
    const failed = await dependencies.repository.fail(
      analysis.id,
      dependencies.leaseToken,
      false,
    );
    if (!failed) throw ownershipLost(error);
    throw providerFailure(error);
  }

  if (providerFile.state === "PROCESSING") {
    return response(analysis, "PROCESSING");
  }

  if (providerFile.state === "NOT_FOUND") {
    const cleared = await dependencies.repository.clearProviderFile(
      analysis.id,
      persistedProviderFile,
      dependencies.leaseToken,
    );
    if (!cleared) throw ownershipLost();
    return response(analysis, "PROVIDER_EXPIRED");
  }

  if (providerFile.state === "FAILED") {
    logFailure(dependencies, {
      analysisId: analysis.id,
      category: "PROVIDER_FILE_FAILED",
      elapsedMs: Math.max(0, now() - startedAt),
      operation: "provider-file-check",
      providerFilePresent: true,
      retryable: false,
    });
    const failed = await dependencies.repository.fail(
      analysis.id,
      dependencies.leaseToken,
      true,
    );
    if (failed) {
      await bestEffortDelete(dependencies.client, persistedProviderFile);
    }
    if (!failed) throw ownershipLost();
    throw providerFailure();
  }

  let transcription;
  try {
    transcription = await dependencies.client.generate(providerFile);
  } catch (error) {
    const classification = classifyTranscriptionError(error);
    logFailure(dependencies, {
      analysisId: analysis.id,
      category: classification.category,
      elapsedMs: Math.max(0, now() - startedAt),
      operation: "transcript-generation",
      providerFilePresent: true,
      retryable: classification.retryable,
    });
    if (classification.retryable) {
      return response(analysis, "RETRYABLE");
    }
    const failed = await dependencies.repository.fail(
      analysis.id,
      dependencies.leaseToken,
      false,
    );
    if (!failed) throw ownershipLost(error);
    throw providerFailure(error);
  }

  const transcriptText = transcription.text.trim();
  if (!transcriptText) {
    logFailure(dependencies, {
      analysisId: analysis.id,
      category: "EMPTY_TRANSCRIPT",
      elapsedMs: Math.max(0, now() - startedAt),
      operation: "transcript-generation",
      providerFilePresent: true,
      retryable: false,
    });
    const failed = await dependencies.repository.fail(
      analysis.id,
      dependencies.leaseToken,
      false,
    );
    if (!failed) throw ownershipLost();
    throw providerFailure();
  }

  const completed = await dependencies.repository.complete(
    analysis.id,
    persistedProviderFile,
    transcriptText,
    dependencies.leaseToken,
  );
  if (!completed) throw ownershipLost();

  await bestEffortDelete(dependencies.client, persistedProviderFile);
  return {
    ...response(analysis, "COMPLETED", AnalysisStatus.EXTRACTING_PDF),
    transcription: { ...transcription, text: transcriptText },
  };
}
