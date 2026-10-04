import {
  createPartFromUri,
  FileState,
  GoogleGenAI,
  type File as GeminiFile,
} from "@google/genai";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const MODEL = "gemini-3.8-flash";
const PREVIEW_LENGTH = 1_000;
const FILE_READY_POLL_INTERVAL_MS = 5_000;
const FILE_READY_TIMEOUT_MS = 20 * 60 * 1_000;

const TRANSCRIPT_PROMPT = `Transcribe the spoken lecture content from this video accurately.
Return only the transcript text.
Do not summarize, explain, or add commentary.`;

const VIDEO_MIME_TYPES = new Map<string, string>([
  [".3gp", "video/3gpp"],
  [".avi", "video/avi"],
  [".flv", "video/x-flv"],
  [".mov", "video/mov"],
  [".mp4", "video/mp4"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpg"],
  [".webm", "video/webm"],
  [".wmv", "video/wmv"],
]);

function usage(): string {
  return 'Usage: npx tsx scripts/gemini-video-poc.ts "C:\\path\\lecture.mp4"';
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(2)} seconds`;
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function errorMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(apiKey, "[REDACTED]");
}

async function waitForFile(
  client: GoogleGenAI,
  initialFile: GeminiFile,
): Promise<GeminiFile> {
  if (!initialFile.name) {
    throw new Error("Gemini Files API did not return a file name.");
  }

  const deadline = Date.now() + FILE_READY_TIMEOUT_MS;
  let file = initialFile;

  while (file.state !== FileState.ACTIVE) {
    if (file.state === FileState.FAILED) {
      const details = file.error?.message ?? "No failure detail was returned.";
      throw new Error(`Gemini could not process the uploaded video: ${details}`);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Gemini did not finish processing the uploaded video within ${formatDuration(FILE_READY_TIMEOUT_MS)}.`,
      );
    }

    await new Promise((resolvePoll) =>
      setTimeout(resolvePoll, FILE_READY_POLL_INTERVAL_MS),
    );
    file = await client.files.get({ name: initialFile.name });
  }

  return file;
}

async function main(): Promise<void> {
  const videoArgument = process.argv[2];
  if (!videoArgument) {
    throw new Error(`A local lecture video path is required.\n${usage()}`);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is required in the process environment. No .env file is loaded by this POC.",
    );
  }

  const videoPath = resolve(videoArgument);
  const extension = extname(videoPath).toLowerCase();
  const mimeType = VIDEO_MIME_TYPES.get(extension);
  if (!mimeType) {
    throw new Error(
      `Unsupported video extension "${extension || "(none)"}". Supported extensions: ${[...VIDEO_MIME_TYPES.keys()].join(", ")}.`,
    );
  }

  const videoStats = await stat(videoPath);
  if (!videoStats.isFile()) {
    throw new Error(`The supplied path is not a file: ${videoPath}`);
  }

  const client = new GoogleGenAI({ apiKey });
  let uploadedFileName: string | undefined;
  const startedAt = performance.now();

  console.log(`Model: ${MODEL}`);
  console.log(`Input: ${basename(videoPath)} (${formatMebibytes(videoStats.size)})`);
  console.log(
    "Upload method: Gemini Files API (SDK-managed resumable upload from local path)",
  );

  try {
    try {
      await client.models.get({ model: MODEL });
    } catch (error) {
      throw new Error(
        `The inspected model ${MODEL} is not available through the configured Gemini API project and installed SDK. ${errorMessage(error, apiKey)}`,
        { cause: error },
      );
    }

    const uploadStartedAt = performance.now();
    const uploadedFile = await client.files.upload({
      file: videoPath,
      config: {
        displayName: basename(videoPath),
        mimeType,
      },
    });
    uploadedFileName = uploadedFile.name;

    const readyFile = await waitForFile(client, uploadedFile);
    const readyAt = performance.now();

    if (!readyFile.uri || !readyFile.mimeType) {
      throw new Error(
        "Gemini marked the file active without returning its URI and MIME type.",
      );
    }

    const response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            createPartFromUri(readyFile.uri, readyFile.mimeType),
            { text: TRANSCRIPT_PROMPT },
          ],
        },
      ],
    });
    const completedAt = performance.now();
    const transcript = response.text?.trim() ?? "";

    if (!transcript) {
      throw new Error("Gemini returned an empty transcript.");
    }

    console.log(`Upload and file processing: ${formatDuration(readyAt - uploadStartedAt)}`);
    console.log(`Transcript generation: ${formatDuration(completedAt - readyAt)}`);
    console.log(`Total processing time: ${formatDuration(completedAt - startedAt)}`);
    console.log(`Transcript length: ${transcript.length} characters`);
    console.log(`Transcript preview (first ${PREVIEW_LENGTH} characters):`);
    console.log("---");
    console.log(transcript.slice(0, PREVIEW_LENGTH));
    console.log("---");
  } catch (error) {
    throw new Error(
      `Gemini POC failed using ${MODEL}. No fallback model was attempted. ${errorMessage(error, apiKey)}`,
      { cause: error },
    );
  } finally {
    if (uploadedFileName) {
      try {
        await client.files.delete({ name: uploadedFileName });
        console.log("Temporary Gemini file deleted.");
      } catch (error) {
        console.warn(
          `Temporary Gemini file cleanup failed: ${errorMessage(error, apiKey)}`,
        );
      }
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
