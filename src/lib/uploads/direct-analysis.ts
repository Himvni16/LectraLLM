import "server-only";

import { AnalysisStatus } from "@prisma/client";

import type { UploadLimits } from "@/lib/env";
import type { CloudinaryVideoStore } from "@/lib/cloudinary/videos";
import type { SupabasePdfStore } from "@/lib/supabase/pdfs";
import {
  cleanUpDirectUpload,
  readFinalizedDirectUpload,
  verifyDirectUpload,
  type DirectUploadDependencies,
} from "@/lib/uploads/direct-upload";
import type {
  AnalysisRepository,
  UploadSuccessResponse,
} from "@/lib/uploads/types";
import { validateUploadMetadataPair } from "@/lib/uploads/validation";

interface CreateDirectAnalysisDependencies extends DirectUploadDependencies {
  repository: AnalysisRepository;
  cloudinary: CloudinaryVideoStore;
  supabase: SupabasePdfStore;
}

export async function createAnalysisFromDirectUpload(
  uploadManifest: string,
  limits: UploadLimits,
  dependencies: CreateDirectAnalysisDependencies,
): Promise<UploadSuccessResponse> {
  const claims = readFinalizedDirectUpload(uploadManifest, dependencies);
  const validated = validateUploadMetadataPair(
    {
      files: [
        {
          source: "VIDEO",
          originalFileName: claims.video.originalFileName,
          contentType: claims.video.contentType,
          size: claims.video.size,
        },
        {
          source: "PDF",
          originalFileName: claims.pdf.originalFileName,
          contentType: claims.pdf.contentType,
          size: claims.pdf.size,
        },
      ],
    },
    limits,
  );

  try {
    await verifyDirectUpload(claims, limits, dependencies);
    const analysis = await dependencies.repository.createUploaded({
      videoFileName: validated.video.originalFileName,
      pdfFileName: validated.pdf.originalFileName,
      videoStoragePath: claims.video.publicId,
      pdfStoragePath: claims.pdf.objectPath,
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
    await cleanUpDirectUpload(claims, dependencies);
    throw error;
  }
}
