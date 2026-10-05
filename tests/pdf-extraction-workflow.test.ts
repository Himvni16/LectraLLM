import { AnalysisStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { StoredPdfUnavailableError } from "@/lib/pdf-extraction/media";
import {
  PdfExtractionClientError,
  type AiPdfExtractionResult,
  type PdfExtractionAnalysis,
  type PdfExtractionClient,
  type PdfExtractionRepository,
  type PdfLocator,
} from "@/lib/pdf-extraction/types";
import { extractAnalysisPdf } from "@/lib/pdf-extraction/workflow";

const transcriptText = "Today we will discuss deadlocks.";
const analysis: PdfExtractionAnalysis = {
  id: "analysis-1",
  videoFileName: "lecture.mp4",
  pdfFileName: "notes.pdf",
  pdfStoragePath: "storage/pdfs/generated.pdf",
  status: AnalysisStatus.EXTRACTING_PDF,
  transcriptText,
  pdfText: null,
};

const extraction: AiPdfExtractionResult = {
  text: "Deadlock prevention requires breaking a necessary condition.",
  pageCount: 2,
  characterCount: 60,
};
const leaseToken = "lease-1";

function createRepository(
  currentAnalysis: PdfExtractionAnalysis | null = analysis,
): PdfExtractionRepository & {
  claim: ReturnType<typeof vi.fn<PdfExtractionRepository["claim"]>>;
  complete: ReturnType<typeof vi.fn<PdfExtractionRepository["complete"]>>;
  fail: ReturnType<typeof vi.fn<PdfExtractionRepository["fail"]>>;
} {
  return {
    findById: vi.fn(async () => currentAnalysis),
    claim: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
  };
}

function createPdfLocator(): PdfLocator {
  return {
    locate: vi.fn(async () => ({
      absolutePath: "C:\\private\\storage\\pdfs\\generated.pdf",
      fileName: "notes.pdf",
    })),
  };
}

describe("analysis PDF extraction workflow", () => {
  it("rejects an unknown analysis ID", async () => {
    const repository = createRepository(null);

    await expect(
      extractAnalysisPdf("missing", {
        client: { extract: vi.fn() },
        leaseToken,
        repository,
        pdfLocator: createPdfLocator(),
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_FOUND", statusCode: 404 });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("rejects extraction before transcription is complete", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.UPLOADED,
      transcriptText: null,
    });

    await expect(
      extractAnalysisPdf(analysis.id, {
        client: { extract: vi.fn() },
        leaseToken,
        repository,
        pdfLocator: createPdfLocator(),
      }),
    ).rejects.toMatchObject({
      code: "PDF_EXTRACTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("handles a missing stored PDF and marks the analysis failed", async () => {
    const repository = createRepository();
    const pdfLocator: PdfLocator = {
      locate: vi.fn(async () => {
        throw new StoredPdfUnavailableError();
      }),
    };

    await expect(
      extractAnalysisPdf(analysis.id, {
        client: { extract: vi.fn() },
        leaseToken,
        repository,
        pdfLocator,
      }),
    ).rejects.toMatchObject({ code: "PDF_UNAVAILABLE", statusCode: 409 });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("persists PDF text and advances to EXTRACTING_TOPICS", async () => {
    let currentStatus: AnalysisStatus = AnalysisStatus.EXTRACTING_PDF;
    const repository = createRepository();
    repository.claim.mockImplementation(async () => {
      currentStatus = AnalysisStatus.EXTRACTING_PDF;
      return true;
    });
    const client: PdfExtractionClient = {
      extract: vi.fn(async () => {
        expect(currentStatus).toBe(AnalysisStatus.EXTRACTING_PDF);
        return extraction;
      }),
    };
    repository.complete.mockImplementation(async (_id, pdfText) => {
      expect(pdfText).toBe(extraction.text);
      currentStatus = AnalysisStatus.EXTRACTING_TOPICS;
      return true;
    });

    const result = await extractAnalysisPdf(analysis.id, {
      client,
      leaseToken,
      repository,
      pdfLocator: createPdfLocator(),
    });

    expect(currentStatus).toBe(AnalysisStatus.EXTRACTING_TOPICS);
    expect(repository.complete).toHaveBeenCalledWith(
      analysis.id,
      extraction.text,
      leaseToken,
    );
    expect(result.status).toBe(AnalysisStatus.EXTRACTING_TOPICS);
    expect(result.text).toBe(extraction.text);
    expect(JSON.stringify(result)).not.toContain("C:\\private");
    expect(JSON.stringify(result)).not.toContain("storage/pdfs");
  });

  it("marks extraction FAILED without changing the transcript", async () => {
    let preservedTranscript = transcriptText;
    const repository = createRepository();
    repository.fail.mockImplementation(async () => {
      preservedTranscript = analysis.transcriptText ?? "";
    });
    const client: PdfExtractionClient = {
      extract: vi.fn(async () => {
        throw new Error("parser failed at C:\\private\\notes.pdf");
      }),
    };

    await expect(
      extractAnalysisPdf(analysis.id, {
        client,
        leaseToken,
        repository,
        pdfLocator: createPdfLocator(),
      }),
    ).rejects.toMatchObject({
      code: "PDF_EXTRACTION_FAILED",
      statusCode: 502,
      message: "The PDF text could not be extracted. You can retry this analysis.",
    });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.complete).not.toHaveBeenCalled();
    expect(preservedTranscript).toBe(transcriptText);
  });

  it("allows a failed post-transcription analysis to retry PDF extraction", async () => {
    const repository = createRepository({ ...analysis, status: AnalysisStatus.FAILED });

    const result = await extractAnalysisPdf(analysis.id, {
      client: { extract: vi.fn(async () => extraction) },
      leaseToken,
      repository,
      pdfLocator: createPdfLocator(),
    });

    expect(repository.claim).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(result.status).toBe(AnalysisStatus.EXTRACTING_TOPICS);
  });

  it("preserves the safe no-text error returned by the PDF parser", async () => {
    const repository = createRepository();

    await expect(
      extractAnalysisPdf(analysis.id, {
        client: {
          extract: vi.fn(async () => {
            throw new PdfExtractionClientError(
              "No extractable text found in PDF.",
            );
          }),
        },
        leaseToken,
        repository,
        pdfLocator: createPdfLocator(),
      }),
    ).rejects.toMatchObject({
      code: "PDF_EXTRACTION_FAILED",
      message: "No extractable text found in PDF.",
    });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
  });
});
