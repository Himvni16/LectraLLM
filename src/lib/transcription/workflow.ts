import { AnalysisStatus } from "@prisma/client";

import type {
  TranscriptionClient,
  TranscriptionRepository,
  TranscriptionSuccessResponse,
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
}

export async function transcribeAnalysis(
  analysisId: string,
  dependencies: TranscriptionWorkflowDependencies,
): Promise<TranscriptionSuccessResponse> {
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
    analysis.status !== AnalysisStatus.FAILED
  ) {
    throw new TranscriptionWorkflowError(
      "TRANSCRIPTION_NOT_ALLOWED",
      "Transcription is not allowed from the current analysis status.",
      409,
    );
  }

  let video;

  try {
    video = await dependencies.videoLocator.locate(
      analysis.videoStoragePath,
      analysis.videoFileName,
    );
  } catch (error) {
    await dependencies.repository.fail(analysis.id, dependencies.leaseToken);
    throw new TranscriptionWorkflowError(
      "VIDEO_UNAVAILABLE",
      "The stored lecture video is unavailable.",
      409,
      { cause: error },
    );
  }

  const claimed = await dependencies.repository.claim(
    analysis.id,
    dependencies.leaseToken,
  );

  if (!claimed) {
    throw new TranscriptionWorkflowError(
      "TRANSCRIPTION_NOT_ALLOWED",
      "The analysis status changed before transcription could start.",
      409,
    );
  }

  try {
    const transcription = await dependencies.client.transcribe(video);
    const transcriptText = transcription.text.trim();

    if (!transcriptText) {
      throw new Error("The transcription service returned an empty transcript.");
    }

    const completed = await dependencies.repository.complete(
      analysis.id,
      transcriptText,
      dependencies.leaseToken,
    );

    if (!completed) {
      throw new Error("The analysis status changed during transcription.");
    }

    return {
      ...transcription,
      text: transcriptText,
      analysisId: analysis.id,
      status: AnalysisStatus.EXTRACTING_PDF,
      videoFileName: analysis.videoFileName,
      pdfFileName: analysis.pdfFileName,
    };
  } catch (error) {
    await dependencies.repository.fail(analysis.id, dependencies.leaseToken);
    throw new TranscriptionWorkflowError(
      "TRANSCRIPTION_FAILED",
      "The lecture could not be transcribed. You can retry this analysis.",
      502,
      { cause: error },
    );
  }
}
