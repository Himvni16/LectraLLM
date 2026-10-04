import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPdfExtractionClient,
  normalizeExtractedText,
} from "@/lib/pdf-extraction/client";
import { PdfExtractionClientError } from "@/lib/pdf-extraction/types";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

function escapePdfText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function createTextPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pageReferences: string[] = [];

  for (const lines of pages) {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    const content = [
      "BT",
      "/F1 12 Tf",
      "72 720 Td",
      "18 TL",
      ...lines.flatMap((line, index) => [
        `(${escapePdfText(line)}) Tj`,
        ...(index < lines.length - 1 ? ["T*"] : []),
      ]),
      "ET",
    ].join("\n");

    pageReferences.push(`${pageObjectNumber} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }

  objects[1] =
    `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "ascii");
}

async function writePdf(contents: Buffer): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lectrallm-pdf-client-"));
  temporaryRoots.push(root);
  const pdfPath = path.join(root, "notes.pdf");
  await writeFile(pdfPath, contents);
  return pdfPath;
}

describe("server-side TypeScript PDF extraction", () => {
  it("extracts PDF text from Supabase bytes without a local file", async () => {
    const contents = createTextPdf([["Supabase lecture notes"]]);
    const getBytes = async () => new Uint8Array(contents);

    const result = await createPdfExtractionClient({
      pdfStore: { getBytes },
    }).extract({
      objectPath: "analyses/c38f8f62-4d06-4f2c-a3ca-d753442e7233/document.pdf",
      fileName: "notes.pdf",
      contentType: "application/pdf",
      size: contents.byteLength,
    });

    expect(result.text).toBe("Supabase lecture notes");
    expect(result.pageCount).toBe(1);
  });

  it("extracts text and metadata from a valid text PDF", async () => {
    const pdfPath = await writePdf(
      createTextPdf([["Deadlock prevention", "Resource ordering"]]),
    );

    const result = await createPdfExtractionClient().extract({
      absolutePath: pdfPath,
      fileName: "notes.pdf",
    });

    expect(result.text).toContain("Deadlock prevention");
    expect(result.text).toContain("Resource ordering");
    expect(result.pageCount).toBe(1);
    expect(result.characterCount).toBe(result.text.length);
  });

  it("preserves page order and separates non-empty pages", async () => {
    const pdfPath = await writePdf(
      createTextPdf([
        ["FIRST PAGE"],
        ["SECOND PAGE"],
        ["THIRD PAGE"],
      ]),
    );

    const result = await createPdfExtractionClient().extract({
      absolutePath: pdfPath,
      fileName: "notes.pdf",
    });

    expect(result.text).toBe("FIRST PAGE\n\nSECOND PAGE\n\nTHIRD PAGE");
    expect(result.pageCount).toBe(3);
  });

  it("normalizes whitespace with the existing conservative rules", () => {
    expect(
      normalizeExtractedText(
        "  Lecture\t  topic  \r\n\r\n\r\n Next\f section \v \r\n",
      ),
    ).toBe("Lecture topic\n\nNext section");
  });

  it("rejects a valid PDF that has no extractable text", async () => {
    const pdfPath = await writePdf(createTextPdf([[]]));

    await expect(
      createPdfExtractionClient().extract({
        absolutePath: pdfPath,
        fileName: "empty.pdf",
      }),
    ).rejects.toMatchObject({
      name: "PdfExtractionClientError",
      message: "No extractable text found in PDF.",
    });
  });

  it("reports a missing stored PDF without leaking its path", async () => {
    const client = createPdfExtractionClient();
    const missingPath = path.join(tmpdir(), "private-missing-notes.pdf");

    const error = await client
      .extract({ absolutePath: missingPath, fileName: "notes.pdf" })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PdfExtractionClientError);
    expect(error).toMatchObject({ message: "PDF could not be read." });
    expect((error as Error).message).not.toContain(missingPath);
  });

  it("enforces the configured PDF extraction size limit", async () => {
    const pdfPath = await writePdf(createTextPdf([["Too large"]]));

    await expect(
      createPdfExtractionClient({ maxSizeBytes: 10 }).extract({
        absolutePath: pdfPath,
        fileName: "notes.pdf",
      }),
    ).rejects.toMatchObject({
      message: "The PDF text could not be extracted.",
    });
  });
});
