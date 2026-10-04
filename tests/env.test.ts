import { afterEach, describe, expect, it } from "vitest";

import {
  getAiServiceUrl,
  getAiTranscriptionTimeoutMs,
  getGeminiApiKey,
  getGeminiTopicModel,
  getTopicChunkChars,
  getUploadLimits,
  requireServerEnv,
  validateServerEnv,
} from "@/lib/env";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAiServiceUrl = process.env.AI_SERVICE_URL;
const originalVideoMaxSize = process.env.VIDEO_MAX_SIZE_MB;
const originalPdfMaxSize = process.env.PDF_MAX_SIZE_MB;
const originalTranscriptionTimeout =
  process.env.AI_TRANSCRIPTION_TIMEOUT_SECONDS;
const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGeminiTopicModel = process.env.GEMINI_TOPIC_MODEL;
const originalTopicChunkChars = process.env.TOPIC_CHUNK_CHARS;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalAiServiceUrl === undefined) {
    delete process.env.AI_SERVICE_URL;
  } else {
    process.env.AI_SERVICE_URL = originalAiServiceUrl;
  }

  if (originalVideoMaxSize === undefined) {
    delete process.env.VIDEO_MAX_SIZE_MB;
  } else {
    process.env.VIDEO_MAX_SIZE_MB = originalVideoMaxSize;
  }

  if (originalPdfMaxSize === undefined) {
    delete process.env.PDF_MAX_SIZE_MB;
  } else {
    process.env.PDF_MAX_SIZE_MB = originalPdfMaxSize;
  }

  if (originalTranscriptionTimeout === undefined) {
    delete process.env.AI_TRANSCRIPTION_TIMEOUT_SECONDS;
  } else {
    process.env.AI_TRANSCRIPTION_TIMEOUT_SECONDS = originalTranscriptionTimeout;
  }

  if (originalGeminiApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGeminiApiKey;
  }

  if (originalGeminiTopicModel === undefined) {
    delete process.env.GEMINI_TOPIC_MODEL;
  } else {
    process.env.GEMINI_TOPIC_MODEL = originalGeminiTopicModel;
  }

  if (originalTopicChunkChars === undefined) {
    delete process.env.TOPIC_CHUNK_CHARS;
  } else {
    process.env.TOPIC_CHUNK_CHARS = originalTopicChunkChars;
  }
});

describe("server environment validation", () => {
  it("returns a configured value", () => {
    process.env.DATABASE_URL = "postgresql://localhost/lectrallm";

    expect(requireServerEnv("DATABASE_URL")).toBe(
      "postgresql://localhost/lectrallm",
    );
  });

  it("fails with a useful message when a required value is absent", () => {
    delete process.env.DATABASE_URL;

    expect(() => requireServerEnv("DATABASE_URL")).toThrow(
      "Missing required environment variable: DATABASE_URL",
    );
  });

  it("normalizes the configured AI service URL", () => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000/";

    expect(getAiServiceUrl()).toBe("http://127.0.0.1:8000");
  });

  it("validates all required server configuration", () => {
    process.env.DATABASE_URL = "postgresql://localhost/lectrallm";
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
    process.env.GEMINI_API_KEY = "test-key";

    expect(() => validateServerEnv()).not.toThrow();
  });

  it("requires Gemini configuration without exposing the key", () => {
    delete process.env.GEMINI_API_KEY;

    expect(() => getGeminiApiKey()).toThrow(
      "Missing required environment variable: GEMINI_API_KEY",
    );
  });

  it("provides Gemini topic defaults and validates configured values", () => {
    delete process.env.GEMINI_TOPIC_MODEL;
    delete process.env.TOPIC_CHUNK_CHARS;

    expect(getGeminiTopicModel()).toBe("gemini-3.5-flash-lite");
    expect(getTopicChunkChars()).toBe(12_000);

    process.env.GEMINI_TOPIC_MODEL = "gemini-custom-flash";
    process.env.TOPIC_CHUNK_CHARS = "24000";
    expect(getGeminiTopicModel()).toBe("gemini-custom-flash");
    expect(getTopicChunkChars()).toBe(24_000);
  });

  it("rejects invalid Gemini topic configuration", () => {
    process.env.GEMINI_TOPIC_MODEL = "  ";
    process.env.TOPIC_CHUNK_CHARS = "999";

    expect(() => getGeminiTopicModel()).toThrow(
      "GEMINI_TOPIC_MODEL must not be blank.",
    );
    expect(() => getTopicChunkChars()).toThrow(
      "TOPIC_CHUNK_CHARS must be an integer from 1000 to 100000.",
    );
  });

  it("provides configurable upload size limits", () => {
    process.env.VIDEO_MAX_SIZE_MB = "300";
    process.env.PDF_MAX_SIZE_MB = "30";

    expect(getUploadLimits()).toEqual({
      videoMaxSizeMb: 300,
      pdfMaxSizeMb: 30,
      videoMaxSizeBytes: 300 * 1024 * 1024,
      pdfMaxSizeBytes: 30 * 1024 * 1024,
    });
  });

  it("provides a configurable AI transcription timeout", () => {
    process.env.AI_TRANSCRIPTION_TIMEOUT_SECONDS = "120";

    expect(getAiTranscriptionTimeoutMs()).toBe(120_000);
  });
});
