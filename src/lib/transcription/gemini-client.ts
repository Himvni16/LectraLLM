import "server-only";

import {
  createPartFromUri,
  FileState,
  GoogleGenAI,
  type File as GeminiFile,
} from "@google/genai";
import path from "node:path";

import {
  createCloudinaryVideoStore,
  type CloudinaryVideoStore,
} from "@/lib/cloudinary/videos";
import {
  getAiTranscriptionTimeoutMs,
  getGeminiApiKey,
  getGeminiTranscriptionModel,
  getUploadLimits,
} from "@/lib/env";
import type {
  AiTranscriptionResult,
  LocatedVideo,
  TranscriptionClient,
} from "@/lib/transcription/types";

const GEMINI_FILES_UPLOAD_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";
const FILE_READY_POLL_INTERVAL_MS = 5_000;
const CLOUDINARY_URL_LIFETIME_SECONDS = 10 * 60;

export const GEMINI_TRANSCRIPTION_PROMPT = `Transcribe the spoken lecture content from this video accurately.
Return only the transcript text.
Do not summarize, explain, or add commentary.`;

interface GeminiTranscriptionInput {
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
  model: string;
}

export interface GeminiTranscriptionProvider {
  transcribe(input: GeminiTranscriptionInput): Promise<string>;
}

interface GeminiFilesApi {
  get(parameters: {
    name: string;
    config?: { abortSignal?: AbortSignal };
  }): Promise<GeminiFile>;
  delete(parameters: {
    name: string;
    config?: { abortSignal?: AbortSignal };
  }): Promise<unknown>;
}

interface GeminiModelsApi {
  generateContent(parameters: Parameters<GoogleGenAI["models"]["generateContent"]>[0]):
    Promise<{ text?: string }>;
}

interface GeminiApi {
  files: GeminiFilesApi;
  models: GeminiModelsApi;
}

interface GoogleGeminiTranscriptionProviderOptions {
  apiKey?: string;
  client?: GeminiApi;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface GeminiTranscriptionClientOptions {
  model?: string;
  provider?: GeminiTranscriptionProvider;
  videoStore?: Pick<CloudinaryVideoStore, "createSignedDownloadUrl">;
  maxSizeBytes?: number;
}

export class GeminiTranscriptionClientError extends Error {
  constructor(message = "Gemini transcription failed.") {
    super(message);
    this.name = "GeminiTranscriptionClientError";
  }
}

function videoFormat(contentType: string): string | null {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return null;
}

function readUploadedFile(value: unknown): GeminiFile {
  if (!value || typeof value !== "object") {
    throw new GeminiTranscriptionClientError();
  }
  const file = (value as { file?: unknown }).file;
  if (!file || typeof file !== "object") {
    throw new GeminiTranscriptionClientError();
  }
  const candidate = file as GeminiFile;
  if (
    typeof candidate.name !== "string" ||
    !candidate.name ||
    typeof candidate.uri !== "string" ||
    !candidate.uri ||
    typeof candidate.mimeType !== "string" ||
    !candidate.mimeType
  ) {
    throw new GeminiTranscriptionClientError();
  }
  return candidate;
}

async function waitForActiveFile(
  client: GeminiApi,
  initialFile: GeminiFile,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<GeminiFile> {
  let file = initialFile;

  while (file.state !== FileState.ACTIVE) {
    if (file.state === FileState.FAILED) {
      throw new GeminiTranscriptionClientError();
    }
    if (!file.name) {
      throw new GeminiTranscriptionClientError();
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, pollIntervalMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    file = await client.files.get({
      name: file.name,
      config: { abortSignal: signal },
    });
  }

  if (!file.uri || !file.mimeType) {
    throw new GeminiTranscriptionClientError();
  }
  return file;
}

export function createGoogleGeminiTranscriptionProvider(
  options: GoogleGeminiTranscriptionProviderOptions = {},
): GeminiTranscriptionProvider {
  const apiKey = options.apiKey ?? getGeminiApiKey();
  const client =
    options.client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs =
    options.pollIntervalMs ?? FILE_READY_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? getAiTranscriptionTimeoutMs();

  return {
    async transcribe(input) {
      const signal = AbortSignal.timeout(timeoutMs);
      let geminiFileName: string | undefined;

      try {
        const startResponse = await fetchImpl(GEMINI_FILES_UPLOAD_URL, {
          method: "POST",
          cache: "no-store",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(input.size),
            "X-Goog-Upload-Header-Content-Type": input.contentType,
          },
          body: JSON.stringify({ file: { display_name: input.fileName } }),
        });
        if (!startResponse.ok) {
          throw new GeminiTranscriptionClientError();
        }
        const uploadUrl = startResponse.headers.get("x-goog-upload-url");
        if (!uploadUrl) {
          throw new GeminiTranscriptionClientError();
        }

        const cloudinaryResponse = await fetchImpl(input.downloadUrl, {
          cache: "no-store",
          signal,
        });
        if (!cloudinaryResponse.ok || !cloudinaryResponse.body) {
          throw new GeminiTranscriptionClientError();
        }
        const sourceLength = Number(
          cloudinaryResponse.headers.get("content-length"),
        );
        if (
          Number.isFinite(sourceLength) &&
          sourceLength > 0 &&
          sourceLength !== input.size
        ) {
          throw new GeminiTranscriptionClientError();
        }

        const uploadRequest: RequestInit & { duplex: "half" } = {
          method: "POST",
          cache: "no-store",
          signal,
          duplex: "half",
          headers: {
            "Content-Length": String(input.size),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
          },
          body: cloudinaryResponse.body,
        };
        const uploadResponse = await fetchImpl(uploadUrl, uploadRequest);
        if (!uploadResponse.ok) {
          throw new GeminiTranscriptionClientError();
        }
        const uploadedFile = readUploadedFile(await uploadResponse.json());
        geminiFileName = uploadedFile.name;
        const readyFile = await waitForActiveFile(
          client,
          uploadedFile,
          signal,
          pollIntervalMs,
        );

        const response = await client.models.generateContent({
          model: input.model,
          contents: [
            {
              role: "user",
              parts: [
                createPartFromUri(readyFile.uri!, readyFile.mimeType!),
                { text: GEMINI_TRANSCRIPTION_PROMPT },
              ],
            },
          ],
          config: { abortSignal: signal },
        });
        return response.text ?? "";
      } catch (error) {
        if (error instanceof GeminiTranscriptionClientError) throw error;
        throw new GeminiTranscriptionClientError();
      } finally {
        if (geminiFileName) {
          try {
            await client.files.delete({
              name: geminiFileName,
              config: { abortSignal: AbortSignal.timeout(5_000) },
            });
          } catch {
            // Cleanup is best-effort; the Files API expires temporary files.
          }
        }
      }
    },
  };
}

export function createGeminiTranscriptionClient(
  options: GeminiTranscriptionClientOptions = {},
): TranscriptionClient {
  const model = options.model ?? getGeminiTranscriptionModel();
  const maxSizeBytes =
    options.maxSizeBytes ?? getUploadLimits().videoMaxSizeBytes;
  const provider =
    options.provider ?? createGoogleGeminiTranscriptionProvider();
  const videoStore = options.videoStore ?? createCloudinaryVideoStore();

  return {
    async transcribe(video: LocatedVideo): Promise<AiTranscriptionResult> {
      if (!("publicId" in video)) {
        throw new GeminiTranscriptionClientError(
          "Gemini transcription requires a stored Cloudinary video.",
        );
      }
      const format = videoFormat(video.contentType);
      if (!format || video.size <= 0 || video.size > maxSizeBytes) {
        throw new GeminiTranscriptionClientError(
          "Stored lecture video metadata is invalid.",
        );
      }

      const downloadUrl = videoStore.createSignedDownloadUrl(
        video.publicId,
        format,
        CLOUDINARY_URL_LIFETIME_SECONDS,
      );
      const text = (
        await provider.transcribe({
          downloadUrl,
          fileName: path.basename(video.fileName),
          contentType: video.contentType,
          size: video.size,
          model,
        })
      ).trim();
      if (!text) {
        throw new GeminiTranscriptionClientError(
          "Gemini returned an empty transcript.",
        );
      }

      return {
        text,
        language: null,
        durationSeconds: null,
        segments: [],
        model,
      };
    },
  };
}
