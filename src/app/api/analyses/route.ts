import { NextResponse } from "next/server";

import { createCloudinaryVideoStore } from "@/lib/cloudinary/videos";
import { getUploadLimits } from "@/lib/env";
import { createSupabasePdfStore } from "@/lib/supabase/pdfs";
import { prismaAnalysisRepository } from "@/lib/uploads/analysis-repository";
import { createAnalysisFromDirectUpload } from "@/lib/uploads/direct-analysis";
import { DirectUploadError } from "@/lib/uploads/direct-upload";
import { UploadRequestError } from "@/lib/uploads/validation";

export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(
      "INVALID_FORM_DATA",
      "The request must use JSON.",
      415,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "INVALID_UPLOAD_MANIFEST",
      "The upload manifest is invalid or has expired.",
      400,
    );
  }

  try {
    const uploadManifest =
      body && typeof body === "object"
        ? (body as { uploadManifest?: unknown }).uploadManifest
        : undefined;
    if (typeof uploadManifest !== "string") {
      return errorResponse(
        "INVALID_UPLOAD_MANIFEST",
        "The upload manifest is invalid or has expired.",
        400,
      );
    }

    const result = await createAnalysisFromDirectUpload(
      uploadManifest,
      getUploadLimits(),
      {
        repository: prismaAnalysisRepository,
        cloudinary: createCloudinaryVideoStore(),
        supabase: createSupabasePdfStore(),
      },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (
      error instanceof UploadRequestError ||
      error instanceof DirectUploadError
    ) {
      return errorResponse(error.code, error.message, error.statusCode);
    }

    console.error("Lecture upload failed.", error);
    return errorResponse(
      "UPLOAD_FAILED",
      "The lecture could not be uploaded. Please try again.",
      500,
    );
  }
}
