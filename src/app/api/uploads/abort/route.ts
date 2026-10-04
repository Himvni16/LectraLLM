import { NextResponse } from "next/server";

import {
  abortDirectUpload,
  DirectUploadError,
} from "@/lib/uploads/direct-upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await abortDirectUpload(await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (!(error instanceof DirectUploadError)) {
      console.error("Direct upload cleanup failed.", error);
    }

    // Cleanup is best-effort and reveals no manifest details to the caller.
    return new NextResponse(null, { status: 204 });
  }
}
