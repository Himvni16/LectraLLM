import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getAiServiceUrl,
  getAiTranscriptionTimeoutMs,
} from "@/lib/env";
import type {
  AiTranscriptionResult,
  LocatedVideo,
  TranscriptionClient,
} from "@/lib/transcription/types";

const VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

function isTranscriptionResult(value: unknown): value is AiTranscriptionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<AiTranscriptionResult>;
  return (
    typeof result.text === "string" &&
    result.text.trim().length > 0 &&
    (typeof result.language === "string" || result.language === null) &&
    (typeof result.durationSeconds === "number" ||
      result.durationSeconds === null) &&
    Array.isArray(result.segments) &&
    typeof result.model === "string"
  );
}

export function createAiTranscriptionClient(): TranscriptionClient {
  return {
    async transcribe(video: LocatedVideo): Promise<AiTranscriptionResult> {
      const extension = path.extname(video.absolutePath).toLowerCase();
      const mimeType = VIDEO_MIME_TYPES[extension];

      if (!mimeType) {
        throw new Error("Stored lecture video has an unsupported format.");
      }

      const contents = await readFile(video.absolutePath);
      const formData = new FormData();
      formData.append(
        "media",
        new Blob([new Uint8Array(contents)], { type: mimeType }),
        video.fileName,
      );

      const response = await fetch(`${getAiServiceUrl()}/transcribe`, {
        method: "POST",
        body: formData,
        cache: "no-store",
        signal: AbortSignal.timeout(getAiTranscriptionTimeoutMs()),
      });

      if (!response.ok) {
        throw new Error(`AI transcription service returned HTTP ${response.status}.`);
      }

      const result: unknown = await response.json();

      if (!isTranscriptionResult(result)) {
        throw new Error("AI transcription service returned an invalid response.");
      }

      return { ...result, text: result.text.trim() };
    },
  };
}
