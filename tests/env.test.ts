import { afterEach, describe, expect, it } from "vitest";

import {
  getAiServiceUrl,
  getAiTranscriptionTimeoutMs,
  getGeminiApiKey,
  getGeminiEmbeddingDimensions,
  getGeminiEmbeddingModel,
  getGeminiTopicModel,
  getCloudinaryConfig,
  getSupabaseStorageConfig,
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
const originalGeminiEmbeddingModel = process.env.GEMINI_EMBEDDING_MODEL;
const originalGeminiEmbeddingDimensions =
  process.env.GEMINI_EMBEDDING_DIMENSIONS;
const storageNames = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_UPLOAD_FOLDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
] as const;
const originalStorageValues = new Map(
  storageNames.map((name) => [name, process.env[name]] as const),
);

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

  if (originalGeminiEmbeddingModel === undefined) {
    delete process.env.GEMINI_EMBEDDING_MODEL;
  } else {
    process.env.GEMINI_EMBEDDING_MODEL = originalGeminiEmbeddingModel;
  }

  if (originalGeminiEmbeddingDimensions === undefined) {
    delete process.env.GEMINI_EMBEDDING_DIMENSIONS;
  } else {
    process.env.GEMINI_EMBEDDING_DIMENSIONS =
      originalGeminiEmbeddingDimensions;
  }

  for (const name of storageNames) {
    const originalValue = originalStorageValues.get(name);
    if (originalValue === undefined) delete process.env[name];
    else process.env[name] = originalValue;
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
    process.env.CLOUDINARY_CLOUD_NAME = "cloud";
    process.env.CLOUDINARY_API_KEY = "api-key";
    process.env.CLOUDINARY_API_SECRET = "api-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_STORAGE_BUCKET = "pdfs";

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

  it("provides Gemini embedding defaults and validates configured values", () => {
    delete process.env.GEMINI_EMBEDDING_MODEL;
    delete process.env.GEMINI_EMBEDDING_DIMENSIONS;

    expect(getGeminiEmbeddingModel()).toBe("gemini-embedding-2");
    expect(getGeminiEmbeddingDimensions()).toBe(768);

    process.env.GEMINI_EMBEDDING_MODEL = "gemini-embedding-custom";
    process.env.GEMINI_EMBEDDING_DIMENSIONS = "1024";
    expect(getGeminiEmbeddingModel()).toBe("gemini-embedding-custom");
    expect(getGeminiEmbeddingDimensions()).toBe(1_024);
  });

  it("rejects invalid Gemini embedding configuration", () => {
    process.env.GEMINI_EMBEDDING_MODEL = "  ";
    process.env.GEMINI_EMBEDDING_DIMENSIONS = "0";

    expect(() => getGeminiEmbeddingModel()).toThrow(
      "GEMINI_EMBEDDING_MODEL must not be blank.",
    );
    expect(() => getGeminiEmbeddingDimensions()).toThrow(
      "GEMINI_EMBEDDING_DIMENSIONS must be an integer from 1 to 3072.",
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

  it("defaults the production video limit to 100 MB", () => {
    delete process.env.VIDEO_MAX_SIZE_MB;
    delete process.env.PDF_MAX_SIZE_MB;

    expect(getUploadLimits()).toMatchObject({
      videoMaxSizeMb: 100,
      videoMaxSizeBytes: 100 * 1024 * 1024,
      pdfMaxSizeMb: 25,
    });
  });

  it("provides a configurable AI transcription timeout", () => {
    process.env.AI_TRANSCRIPTION_TIMEOUT_SECONDS = "120";

    expect(getAiTranscriptionTimeoutMs()).toBe(120_000);
  });

  it("validates Cloudinary and Supabase storage configuration", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "cloud";
    process.env.CLOUDINARY_API_KEY = "api-key";
    process.env.CLOUDINARY_API_SECRET = "api-secret";
    delete process.env.CLOUDINARY_UPLOAD_FOLDER;
    process.env.SUPABASE_URL = "https://project.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_STORAGE_BUCKET = "pdfs";

    expect(getCloudinaryConfig()).toEqual({
      cloudName: "cloud",
      apiKey: "api-key",
      apiSecret: "api-secret",
      uploadFolder: "lectrallm/videos",
    });
    expect(getSupabaseStorageConfig()).toEqual({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role",
      bucket: "pdfs",
    });

    process.env.CLOUDINARY_UPLOAD_FOLDER = "../unsafe";
    expect(() => getCloudinaryConfig()).toThrow(
      "CLOUDINARY_UPLOAD_FOLDER must be a relative Cloudinary folder path.",
    );
  });
});
