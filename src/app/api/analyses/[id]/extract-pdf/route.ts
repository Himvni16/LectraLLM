import { NextResponse } from "next/server";

import { createAiPdfExtractionClient } from "@/lib/pdf-extraction/ai-client";
import { createStoredPdfLocator } from "@/lib/pdf-extraction/media";
import { prismaPdfExtractionRepository } from "@/lib/pdf-extraction/repository";
import {
  extractAnalysisPdf,
  PdfExtractionWorkflowError,
} from "@/lib/pdf-extraction/workflow";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await extractAnalysisPdf(id, {
      client: createAiPdfExtractionClient(),
      repository: prismaPdfExtractionRepository,
      pdfLocator: createStoredPdfLocator(),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PdfExtractionWorkflowError) {
      if (error.code === "PDF_EXTRACTION_FAILED") {
        console.error("Analysis PDF extraction failed.", error.cause);
      }

      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Unexpected PDF extraction error.", error);
    return NextResponse.json(
      {
        error: {
          code: "PDF_EXTRACTION_FAILED",
          message: "The PDF text could not be extracted.",
        },
      },
      { status: 500 },
    );
  }
}
