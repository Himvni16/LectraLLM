import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

const [, , pdfPathArgument] = process.argv;
if (!pdfPathArgument) {
  throw new Error(
    'Usage: node --conditions=react-server --import tsx scripts/pdf-text-poc.ts "C:\\path\\document.pdf"',
  );
}

nextEnv.loadEnvConfig(process.cwd());

const pdfPath = path.resolve(pdfPathArgument);
const pdfFileName = path.basename(pdfPath);
const outputDirectory = fileURLToPath(new URL("./output/", import.meta.url));
const outputFileName = `${path.basename(pdfFileName, path.extname(pdfFileName))}.txt`;
const outputPath = path.join(outputDirectory, outputFileName);
const { createPdfExtractionClient } = await import(
  "../src/lib/pdf-extraction/client"
);

const result = await createPdfExtractionClient().extract({
  absolutePath: pdfPath,
  fileName: pdfFileName,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, result.text, "utf8");

console.log(`Page count: ${result.pageCount}`);
console.log(`Character count: ${result.characterCount}`);
console.log(`Saved output path: ${outputPath}`);
