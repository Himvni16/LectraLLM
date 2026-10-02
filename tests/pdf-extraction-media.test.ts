import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createStoredPdfLocator,
  StoredPdfUnavailableError,
} from "@/lib/pdf-extraction/media";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("stored PDF lookup", () => {
  it("resolves only existing PDF files inside storage/pdfs", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "lectrallm-pdf-test-"),
    );
    temporaryRoots.push(workspaceRoot);
    const pdfDirectory = path.join(workspaceRoot, "storage", "pdfs");
    const storedPath = path.join(pdfDirectory, "generated.pdf");
    await mkdir(pdfDirectory, { recursive: true });
    await writeFile(storedPath, "%PDF-test");
    const locator = createStoredPdfLocator({ workspaceRoot });

    await expect(
      locator.locate("storage/pdfs/generated.pdf", "lecture-notes.pdf"),
    ).resolves.toEqual({
      absolutePath: storedPath,
      fileName: "lecture-notes.pdf",
    });
  });

  it("rejects traversal, non-PDF extensions, and other storage areas", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "lectrallm-pdf-test-"),
    );
    temporaryRoots.push(workspaceRoot);
    const locator = createStoredPdfLocator({ workspaceRoot });

    await expect(
      locator.locate("storage/pdfs/../../.env", "notes.pdf"),
    ).rejects.toBeInstanceOf(StoredPdfUnavailableError);
    await expect(
      locator.locate("storage/videos/lecture.mp4", "notes.pdf"),
    ).rejects.toBeInstanceOf(StoredPdfUnavailableError);
    await expect(
      locator.locate("storage/pdfs/notes.txt", "notes.pdf"),
    ).rejects.toBeInstanceOf(StoredPdfUnavailableError);
    await expect(
      locator.locate("C:\\Windows\\system.ini", "notes.pdf"),
    ).rejects.toBeInstanceOf(StoredPdfUnavailableError);
  });
});
