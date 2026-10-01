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
  UploadRequestError,
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
