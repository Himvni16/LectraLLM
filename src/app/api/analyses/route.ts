import { NextResponse } from "next/server";

import { getUploadLimits } from "@/lib/env";
import { createAnalysisUpload } from "@/lib/uploads/analysis-upload";
import { prismaAnalysisRepository } from "@/lib/uploads/analysis-repository";
import { createLocalUploadStorage } from "@/lib/uploads/local-storage";
import {
  parseUploadFormData,
  UploadRequestError,
} from "@/lib/uploads/validation";

export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse(
      "INVALID_FORM_DATA",
      "The request must use multipart form data.",
      415,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    console.warn("Invalid multipart upload request.", error);
    return errorResponse(
      "INVALID_FORM_DATA",
      "The upload form could not be read.",
      400,
    );
  }

  try {
    const upload = parseUploadFormData(formData);
    const result = await createAnalysisUpload(upload, getUploadLimits(), {
      repository: prismaAnalysisRepository,
      storage: createLocalUploadStorage(),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UploadRequestError) {
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
