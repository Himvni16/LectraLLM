import { NextResponse } from "next/server";

import { getUploadLimits } from "@/lib/env";
import {
  DirectUploadError,
  initiateDirectUpload,
} from "@/lib/uploads/direct-upload";
import { UploadRequestError } from "@/lib/uploads/validation";

export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return errorResponse("INVALID_FORM_DATA", "The request must use JSON.", 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_FORM_DATA", "The upload metadata could not be read.", 400);
  }

  try {
    const result = await initiateDirectUpload(body, getUploadLimits());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UploadRequestError || error instanceof DirectUploadError) {
      return errorResponse(error.code, error.message, error.statusCode);
    }

    console.error("Direct upload initiation failed.", error);
    return errorResponse(
      "UPLOAD_INIT_FAILED",
      "The upload could not be prepared. Please try again.",
      500,
    );
  }
}
