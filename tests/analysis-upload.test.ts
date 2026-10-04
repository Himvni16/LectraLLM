import { AnalysisStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { UploadLimits } from "@/lib/env";
import { createAnalysisUpload } from "@/lib/uploads/analysis-upload";
import type {
  AnalysisRepository,
  UploadStorage,
} from "@/lib/uploads/types";
import {
  parseUploadFormData,
  sanitizeOriginalFileName,
  UploadRequestError,
  validateUploadMetadataPair,
  validateUploadPair,
} from "@/lib/uploads/validation";

const limits: UploadLimits = {
  videoMaxSizeMb: 10,
  pdfMaxSizeMb: 5,
  videoMaxSizeBytes: 10,
  pdfMaxSizeBytes: 5,
};

function videoFile(
  name = "lecture.mp4",
  type = "video/mp4",
  size = 4,
) {
  return new File([new Uint8Array(size)], name, { type });
}

function pdfFile(name = "notes.pdf", type = "application/pdf", size = 4) {
  return new File([new Uint8Array(size)], name, { type });
}

function expectUploadError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected upload validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(UploadRequestError);
    expect((error as UploadRequestError).code).toBe(code);
  }
}

describe("upload form validation", () => {
  it("enforces the 100 MB production video limit", () => {
    const productionLimits: UploadLimits = {
      videoMaxSizeMb: 100,
      pdfMaxSizeMb: 25,
      videoMaxSizeBytes: 100 * 1024 * 1024,
      pdfMaxSizeBytes: 25 * 1024 * 1024,
    };
    const metadata = {
      files: [
        {
          source: "VIDEO",
          originalFileName: "lecture.mp4",
          contentType: "video/mp4",
          size: 100 * 1024 * 1024,
        },
        {
          source: "PDF",
          originalFileName: "notes.pdf",
          contentType: "application/pdf",
          size: 1,
        },
      ],
    };

    expect(() =>
      validateUploadMetadataPair(metadata, productionLimits),
    ).not.toThrow();
    metadata.files[0].size += 1;
    expectUploadError(
      () => validateUploadMetadataPair(metadata, productionLimits),
      "VIDEO_TOO_LARGE",
    );
  });

  it("validates metadata-only direct uploads with the same file rules", () => {
    expect(
      validateUploadMetadataPair(
        {
          files: [
            {
              source: "VIDEO",
              originalFileName: "C:\\fakepath\\lecture.mp4",
              contentType: "video/mp4",
              size: 4,
            },
            {
              source: "PDF",
              originalFileName: "notes.pdf",
              contentType: "application/pdf",
              size: 4,
            },
          ],
        },
        limits,
      ),
    ).toMatchObject({
      video: { originalFileName: "lecture.mp4", extension: ".mp4" },
      pdf: { originalFileName: "notes.pdf", extension: ".pdf" },
    });
  });

  it("accepts browser metadata with an empty MIME type using its valid extension", () => {
    expect(
      validateUploadMetadataPair(
        {
          files: [
            {
              source: "VIDEO",
              originalFileName: "lecture.webm",
              contentType: "",
              size: 4,
            },
            {
              source: "PDF",
              originalFileName: "notes.pdf",
              contentType: "",
              size: 4,
            },
          ],
        },
        limits,
      ),
    ).toMatchObject({
      video: { contentType: "video/webm" },
      pdf: { contentType: "application/pdf" },
    });
  });

  it.each([
    ["invalid extension", "lecture.exe", "video/mp4", 4, "INVALID_VIDEO_TYPE"],
    ["invalid MIME", "lecture.mp4", "text/plain", 4, "INVALID_VIDEO_TYPE"],
    ["oversized file", "lecture.mp4", "video/mp4", 11, "VIDEO_TOO_LARGE"],
  ])("rejects direct-upload metadata with an %s", (_label, name, type, size, code) => {
    expectUploadError(
      () =>
        validateUploadMetadataPair(
          {
            files: [
              {
                source: "VIDEO",
                originalFileName: name,
                contentType: type,
                size,
              },
              {
                source: "PDF",
                originalFileName: "notes.pdf",
                contentType: "application/pdf",
                size: 4,
              },
            ],
          },
          limits,
        ),
      code,
    );
  });

  it.each([
    ["notes.txt", "application/pdf", 4, "INVALID_PDF_TYPE"],
    ["notes.pdf", "text/plain", 4, "INVALID_PDF_TYPE"],
    ["notes.pdf", "application/pdf", 6, "PDF_TOO_LARGE"],
  ])(
    "rejects invalid direct-upload PDF metadata (%s, %s)",
    (name, type, size, code) => {
      expectUploadError(
        () =>
          validateUploadMetadataPair(
            {
              files: [
                {
                  source: "VIDEO",
                  originalFileName: "lecture.mp4",
                  contentType: "video/mp4",
                  size: 4,
                },
                {
                  source: "PDF",
                  originalFileName: name,
                  contentType: type,
                  size,
                },
              ],
            },
            limits,
          ),
        code,
      );
    },
  );

  it("rejects a missing video", () => {
    const formData = new FormData();
    formData.append("pdf", pdfFile());

    expectUploadError(() => parseUploadFormData(formData), "MISSING_VIDEO");
  });

  it("rejects a missing PDF", () => {
    const formData = new FormData();
    formData.append("video", videoFile());

    expectUploadError(() => parseUploadFormData(formData), "MISSING_PDF");
  });

  it("rejects an invalid video type", () => {
    expectUploadError(
      () =>
        validateUploadPair(
          { video: videoFile("lecture.txt", "text/plain"), pdf: pdfFile() },
          limits,
        ),
      "INVALID_VIDEO_TYPE",
    );
  });

  it.each([
    videoFile("lecture.txt", "video/mp4"),
    videoFile("lecture.mp4", "text/plain"),
  ])("requires both an allowed video extension and MIME type", (video) => {
    expectUploadError(
      () => validateUploadPair({ video, pdf: pdfFile() }, limits),
      "INVALID_VIDEO_TYPE",
    );
  });

  it("rejects an invalid PDF type", () => {
    expectUploadError(
      () =>
        validateUploadPair(
          {
            video: videoFile(),
            pdf: pdfFile("notes.pdf", "text/plain"),
          },
          limits,
        ),
      "INVALID_PDF_TYPE",
    );
  });

  it("rejects a PDF MIME type paired with a non-PDF extension", () => {
    expectUploadError(
      () =>
        validateUploadPair(
          { video: videoFile(), pdf: pdfFile("notes.txt", "application/pdf") },
          limits,
        ),
      "INVALID_PDF_TYPE",
    );
  });

  it.each([
    {
      label: "video",
      upload: { video: videoFile("lecture.mp4", "video/mp4", 0), pdf: pdfFile() },
      code: "EMPTY_VIDEO",
    },
    {
      label: "PDF",
      upload: { video: videoFile(), pdf: pdfFile("notes.pdf", "application/pdf", 0) },
      code: "EMPTY_PDF",
    },
  ])("rejects an empty $label", ({ upload, code }) => {
    expectUploadError(() => validateUploadPair(upload, limits), code);
  });

  it("sanitizes an unsafe browser-supplied filename", () => {
    expect(sanitizeOriginalFileName("C:\\fakepath\\..\\unsafe\u0000.pdf")).toBe(
      "unsafe.pdf",
    );
  });

  it.each([
    {
      label: "video",
      upload: { video: videoFile("lecture.mp4", "video/mp4", 11), pdf: pdfFile() },
      code: "VIDEO_TOO_LARGE",
    },
    {
      label: "PDF",
      upload: { video: videoFile(), pdf: pdfFile("notes.pdf", "application/pdf", 6) },
      code: "PDF_TOO_LARGE",
    },
  ])("rejects an oversized $label", ({ upload, code }) => {
    expectUploadError(() => validateUploadPair(upload, limits), code);
  });
});

describe("analysis upload orchestration", () => {
  it("stores valid files and creates an UPLOADED analysis", async () => {
    const storage: UploadStorage = {
      save: vi.fn(async (_file, kind, extension) => ({
        storagePath: `storage/${kind === "video" ? "videos" : "pdfs"}/generated${extension}`,
        cleanupPath: `C:\\private\\generated${extension}`,
      })),
      remove: vi.fn(async () => undefined),
    };
    const createUploaded = vi.fn<AnalysisRepository["createUploaded"]>(
      async (data) => ({
        id: "analysis-123",
        status: data.status,
        videoFileName: data.videoFileName,
        pdfFileName: data.pdfFileName,
      }),
    );

    const result = await createAnalysisUpload(
      { video: videoFile(), pdf: pdfFile() },
      limits,
      { repository: { createUploaded }, storage },
    );

    expect(createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AnalysisStatus.UPLOADED,
        transcriptText: null,
        pdfText: null,
        overallSimilarityScore: null,
      }),
    );
    expect(result).toEqual({
      analysisId: "analysis-123",
      status: AnalysisStatus.UPLOADED,
      videoFileName: "lecture.mp4",
      pdfFileName: "notes.pdf",
    });
    expect(JSON.stringify(result)).not.toContain("C:\\private");
    expect(JSON.stringify(result)).not.toContain("storage/");
  });

  it("removes both stored files when database creation fails", async () => {
    const remove = vi.fn(async () => undefined);
    const storage: UploadStorage = {
      save: vi.fn(async (_file, kind, extension) => ({
        storagePath: `storage/${kind}s/generated${extension}`,
        cleanupPath: `C:\\private\\generated${extension}`,
      })),
      remove,
    };
    const repository: AnalysisRepository = {
      createUploaded: vi.fn(async () => {
        throw new Error("Database unavailable");
      }),
    };

    await expect(
      createAnalysisUpload(
        { video: videoFile(), pdf: pdfFile() },
        limits,
        { repository, storage },
      ),
    ).rejects.toThrow("Database unavailable");
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
