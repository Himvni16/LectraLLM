import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

const [, , pdfPathArgument] = process.argv;
if (!pdfPathArgument) {
  throw new Error(
    'Usage: node --conditions=react-server --import tsx scripts/supabase-pdf-poc.ts "C:\\path\\document.pdf"',
  );
}
nextEnv.loadEnvConfig(process.cwd());

const pdfPath = path.resolve(pdfPathArgument);
const fileStats = await stat(pdfPath);
if (!fileStats.isFile() || fileStats.size === 0 || path.extname(pdfPath).toLowerCase() !== ".pdf") {
  throw new Error("The POC path must reference a non-empty PDF file.");
}

const { getSupabaseStorageConfig, getUploadLimits } = await import(
  "../src/lib/env"
);
const { createSupabasePdfStore } = await import("../src/lib/supabase/pdfs");
const config = getSupabaseStorageConfig();
if (fileStats.size > getUploadLimits().pdfMaxSizeBytes) {
  throw new Error("The POC PDF exceeds the configured PDF limit.");
}
const client = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const objectPath = `poc/${randomUUID()}/document.pdf`;
const store = createSupabasePdfStore({ config, client });
let uploaded = false;

try {
  const { error } = await client.storage
    .from(config.bucket)
    .upload(objectPath, await readFile(pdfPath), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (error) throw error;
  uploaded = true;
  const metadata = await store.inspect(objectPath);
  const bytes = await store.getBytes(objectPath, getUploadLimits().pdfMaxSizeBytes);
  console.log(`Object path: ${metadata.objectPath}`);
  console.log(`Content type: ${metadata.contentType}`);
  console.log(`Size: ${metadata.size}`);
  console.log(`Downloaded bytes: ${bytes.byteLength}`);
} finally {
  if (uploaded) {
    await store.delete(objectPath);
    console.log("Temporary Supabase PDF deleted.");
  }
}
