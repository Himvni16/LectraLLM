import { NextResponse } from "next/server";

import { getUploadLimits } from "@/lib/env";
import {
  DirectUploadError,
  finalizeDirectUpload,
} from "@/lib/uploads/direct-upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_UPLOAD_MANIFEST",
          message: "The upload manifest is invalid or has expired.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await finalizeDirectUpload(body, getUploadLimits());
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DirectUploadError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Direct upload finalization failed.", error);
    return NextResponse.json(
      {
        error: {
          code: "UPLOAD_FINALIZATION_FAILED",
          message: "The upload could not be finalized. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}
