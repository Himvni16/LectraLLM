import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalUploadStorage } from "@/lib/uploads/local-storage";
import { validateUploadPair } from "@/lib/uploads/validation";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local upload storage", () => {
  it("uses generated names and keeps videos separate from PDFs", async () => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "lectrallm-upload-test-"),
    );
    temporaryRoots.push(rootDirectory);
    const storage = createLocalUploadStorage({ rootDirectory });
    const video = new File(["video-bytes"], "../../unsafe-lecture.mp4", {
      type: "video/mp4",
    });
    const pdf = new File(["pdf-bytes"], "..\\unsafe-notes.pdf", {
      type: "application/pdf",
    });
    const validated = validateUploadPair(
      { video, pdf },
      {
        videoMaxSizeMb: 1,
        pdfMaxSizeMb: 1,
        videoMaxSizeBytes: 1024,
        pdfMaxSizeBytes: 1024,
      },
    );

    const storedVideo = await storage.save(
      validated.video.file,
      "video",
      validated.video.extension,
    );
    const storedPdf = await storage.save(
      validated.pdf.file,
      "pdf",
      validated.pdf.extension,
    );

    expect(validated.video.originalFileName).toBe("unsafe-lecture.mp4");
    expect(validated.pdf.originalFileName).toBe("unsafe-notes.pdf");
    expect(storedVideo.storagePath).toMatch(
      /^storage\/videos\/[0-9a-f-]+\.mp4$/,
    );
    expect(storedPdf.storagePath).toMatch(/^storage\/pdfs\/[0-9a-f-]+\.pdf$/);
    expect(path.basename(storedVideo.cleanupPath)).not.toContain("unsafe");
    expect(path.basename(storedPdf.cleanupPath)).not.toContain("unsafe");
    await expect(readFile(storedVideo.cleanupPath, "utf8")).resolves.toBe(
      "video-bytes",
    );
    await expect(readFile(storedPdf.cleanupPath, "utf8")).resolves.toBe(
      "pdf-bytes",
    );
  });
});
