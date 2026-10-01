import { AnalysisStatus } from "@prisma/client";

import type { UploadLimits } from "@/lib/env";
import type {
  AnalysisRepository,
  StoredUpload,
  UploadStorage,
  UploadSuccessResponse,
} from "@/lib/uploads/types";
import {
  type UploadPair,
  validateUploadPair,
} from "@/lib/uploads/validation";

interface CreateAnalysisUploadDependencies {
  repository: AnalysisRepository;
  storage: UploadStorage;
}

async function cleanUpFiles(
  storage: UploadStorage,
  files: StoredUpload[],
): Promise<void> {
  const results = await Promise.allSettled(
    files.map((file) => storage.remove(file)),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to clean up an uploaded file.", result.reason);
    }
  }
}

export async function createAnalysisUpload(
  upload: UploadPair,
  limits: UploadLimits,
  dependencies: CreateAnalysisUploadDependencies,
): Promise<UploadSuccessResponse> {
  const validated = validateUploadPair(upload, limits);
  const storedFiles: StoredUpload[] = [];

  try {
    const storedVideo = await dependencies.storage.save(
      validated.video.file,
      "video",
      validated.video.extension,
    );
    storedFiles.push(storedVideo);

    const storedPdf = await dependencies.storage.save(
      validated.pdf.file,
      "pdf",
      validated.pdf.extension,
    );
    storedFiles.push(storedPdf);

    const analysis = await dependencies.repository.createUploaded({
      videoFileName: validated.video.originalFileName,
      pdfFileName: validated.pdf.originalFileName,
      videoStoragePath: storedVideo.storagePath,
      pdfStoragePath: storedPdf.storagePath,
      status: AnalysisStatus.UPLOADED,
      transcriptText: null,
      pdfText: null,
      overallSimilarityScore: null,
    });

    return {
      analysisId: analysis.id,
      status: analysis.status,
      videoFileName: analysis.videoFileName,
      pdfFileName: analysis.pdfFileName,
    };
  } catch (error) {
    await cleanUpFiles(dependencies.storage, storedFiles);
    throw error;
  }
}
