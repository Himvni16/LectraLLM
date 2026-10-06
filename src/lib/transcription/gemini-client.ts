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
  getGeminiApiKey,
  getGeminiTranscriptionTimeoutMs,
  getGeminiTranscriptionModel,
  getUploadLimits,
} from "@/lib/env";
import {
  classifyTranscriptionError,
  providerHttpError,
  TranscriptionOperationError,
  type TranscriptionErrorCategory,
} from "@/lib/transcription/errors";
import type {
  AiTranscriptionResult,
  TranscriptionClient,
  TranscriptionProviderFile,
} from "@/lib/transcription/types";

const GEMINI_FILES_UPLOAD_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";
const CLOUDINARY_URL_LIFETIME_SECONDS = 10 * 60;

export const GEMINI_TRANSCRIPTION_PROMPT = `Transcribe the spoken lecture content from this video accurately.
Return only the transcript text.
Do not summarize, explain, or add commentary.`;

interface GeminiUploadInput {
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface GeminiTranscriptionProvider {
  upload(input: GeminiUploadInput): Promise<TranscriptionProviderFile>;
  getFile(name: string): Promise<TranscriptionProviderFile>;
  generate(file: TranscriptionProviderFile, model: string): Promise<string>;
  deleteFile(name: string): Promise<void>;
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
  generateContent(
    parameters: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  ): Promise<{ text?: string }>;
}

interface GeminiApi {
  files: GeminiFilesApi;
  models: GeminiModelsApi;
}

interface GoogleGeminiTranscriptionProviderOptions {
  apiKey?: string;
  client?: GeminiApi;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiTranscriptionClientOptions {
  model?: string;
  provider?: GeminiTranscriptionProvider;
  videoStore?: Pick<CloudinaryVideoStore, "createSignedDownloadUrl">;
  maxSizeBytes?: number;
}

export class GeminiTranscriptionClientError extends TranscriptionOperationError {
  constructor(
    message = "Gemini transcription failed.",
    category: TranscriptionErrorCategory = "UNKNOWN",
    retryable = false,
  ) {
    super(message, category, retryable);
    this.name = "GeminiTranscriptionClientError";
  }
}

function safeProviderError(error: unknown): GeminiTranscriptionClientError {
  const classification = classifyTranscriptionError(error);
  return new GeminiTranscriptionClientError(
    "Gemini transcription failed.",
    classification.category,
    classification.retryable,
  );
}

function malformedProviderResponse(): GeminiTranscriptionClientError {
  return new GeminiTranscriptionClientError(
    "Gemini transcription failed.",
    "MALFORMED_PROVIDER_RESPONSE",
    false,
  );
}

function videoFormat(contentType: string): string | null {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return null;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

function normalizeFile(
  value: unknown,
  fallbackName?: string,
): TranscriptionProviderFile {
  if (!value || typeof value !== "object") {
    throw malformedProviderResponse();
  }
  const file = value as GeminiFile;
  const name =
    typeof file.name === "string" && file.name ? file.name : fallbackName;
  if (!name) throw malformedProviderResponse();

  if (file.state === FileState.PROCESSING) {
    return { name, state: "PROCESSING", uri: null, mimeType: null };
  }
  if (
    file.state === FileState.ACTIVE &&
    typeof file.uri === "string" &&
    file.uri &&
    typeof file.mimeType === "string" &&
    file.mimeType
  ) {
    return {
      name,
      state: "ACTIVE",
      uri: file.uri,
      mimeType: file.mimeType,
    };
  }

  return { name, state: "FAILED", uri: null, mimeType: null };
}

function readUploadedFile(value: unknown): TranscriptionProviderFile {
  if (!value || typeof value !== "object" || !("file" in value)) {
    throw malformedProviderResponse();
  }
  return normalizeFile((value as { file: unknown }).file);
}

export function createGoogleGeminiTranscriptionProvider(
  options: GoogleGeminiTranscriptionProviderOptions = {},
): GeminiTranscriptionProvider {
  const apiKey = options.apiKey ?? getGeminiApiKey();
  const client =
    options.client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? getGeminiTranscriptionTimeoutMs();

  return {
    async upload(input) {
      const signal = AbortSignal.timeout(timeoutMs);
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
        if (!startResponse.ok) throw providerHttpError(startResponse.status);
        const uploadUrl = startResponse.headers.get("x-goog-upload-url");
        if (!uploadUrl) throw malformedProviderResponse();

        const cloudinaryResponse = await fetchImpl(input.downloadUrl, {
          cache: "no-store",
          signal,
        });
        if (!cloudinaryResponse.ok || !cloudinaryResponse.body) {
          if (!cloudinaryResponse.ok) {
            throw providerHttpError(cloudinaryResponse.status);
          }
          throw malformedProviderResponse();
        }
        const sourceLength = Number(
          cloudinaryResponse.headers.get("content-length"),
        );
        if (
          Number.isFinite(sourceLength) &&
          sourceLength > 0 &&
          sourceLength !== input.size
        ) {
          throw malformedProviderResponse();
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
        if (!uploadResponse.ok) throw providerHttpError(uploadResponse.status);
        return readUploadedFile(await uploadResponse.json());
      } catch (error) {
        if (error instanceof TranscriptionOperationError) throw error;
        throw safeProviderError(error);
      }
    },

    async getFile(name) {
      try {
        return normalizeFile(
          await client.files.get({
            name,
            config: { abortSignal: AbortSignal.timeout(timeoutMs) },
          }),
          name,
        );
      } catch (error) {
        if (isNotFoundError(error)) {
          return { name, state: "NOT_FOUND", uri: null, mimeType: null };
        }
        if (error instanceof TranscriptionOperationError) throw error;
        throw safeProviderError(error);
      }
    },

    async generate(file, model) {
      if (file.state !== "ACTIVE" || !file.uri || !file.mimeType) {
        throw new GeminiTranscriptionClientError();
      }
      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                createPartFromUri(file.uri, file.mimeType),
                { text: GEMINI_TRANSCRIPTION_PROMPT },
              ],
            },
          ],
          config: { abortSignal: AbortSignal.timeout(timeoutMs) },
        });
        return response.text ?? "";
      } catch (error) {
        if (error instanceof TranscriptionOperationError) throw error;
        throw safeProviderError(error);
      }
    },

    async deleteFile(name) {
      try {
        await client.files.delete({
          name,
          config: { abortSignal: AbortSignal.timeout(5_000) },
        });
      } catch {
        // Cleanup is best-effort; Gemini Files are temporary.
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
    async upload(video) {
      if (!("publicId" in video)) {
        throw new GeminiTranscriptionClientError(
          "Gemini transcription requires a stored Cloudinary video.",
          "INVALID_CLOUDINARY_ASSET",
          false,
        );
      }
      const format = videoFormat(video.contentType);
      if (!format || video.size <= 0 || video.size > maxSizeBytes) {
        throw new GeminiTranscriptionClientError(
          "Stored lecture video metadata is invalid.",
          "INVALID_CLOUDINARY_ASSET",
          false,
        );
      }

      const downloadUrl = videoStore.createSignedDownloadUrl(
        video.publicId,
        format,
        CLOUDINARY_URL_LIFETIME_SECONDS,
      );
      return provider.upload({
        downloadUrl,
        fileName: path.basename(video.fileName),
        contentType: video.contentType,
        size: video.size,
      });
    },

    getFile: (name) => provider.getFile(name),

    async generate(file): Promise<AiTranscriptionResult> {
      const text = (await provider.generate(file, model)).trim();
      if (!text) {
        throw new GeminiTranscriptionClientError(
          "Gemini returned an empty transcript.",
          "EMPTY_TRANSCRIPT",
          false,
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

    deleteFile: (name) => provider.deleteFile(name),
  };
}
