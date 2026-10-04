import "server-only";

type ServerEnvName = "DATABASE_URL" | "AI_SERVICE_URL" | "GEMINI_API_KEY";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_VIDEO_MAX_SIZE_MB = 250;
const DEFAULT_PDF_MAX_SIZE_MB = 25;

export interface UploadLimits {
  videoMaxSizeMb: number;
  pdfMaxSizeMb: number;
  videoMaxSizeBytes: number;
  pdfMaxSizeBytes: number;
}

const DEFAULT_AI_TRANSCRIPTION_TIMEOUT_SECONDS = 1800;
const DEFAULT_GEMINI_TOPIC_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TOPIC_CHUNK_CHARS = 12_000;
const MIN_TOPIC_CHUNK_CHARS = 1_000;
const MAX_TOPIC_CHUNK_CHARS = 100_000;
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
const DEFAULT_GEMINI_EMBEDDING_DIMENSIONS = 768;
const MAX_GEMINI_EMBEDDING_DIMENSIONS = 3_072;

export function requireServerEnv(name: ServerEnvName): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env.local and provide a value.`,
    );
  }

  return value;
}

export function getAiServiceUrl(): string {
  const value = requireServerEnv("AI_SERVICE_URL");

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      "AI_SERVICE_URL must be a valid absolute URL, for example http://127.0.0.1:8000.",
    );
  }
}

export function getGeminiApiKey(): string {
  return requireServerEnv("GEMINI_API_KEY");
}

export function getGeminiTopicModel(): string {
  const configuredModel = process.env.GEMINI_TOPIC_MODEL;

  if (configuredModel === undefined) {
    return DEFAULT_GEMINI_TOPIC_MODEL;
  }

  const model = configuredModel.trim();
  if (!model) {
    throw new Error("GEMINI_TOPIC_MODEL must not be blank.");
  }

  return model;
}

export function getTopicChunkChars(): number {
  const rawValue = process.env.TOPIC_CHUNK_CHARS;

  if (rawValue === undefined) {
    return DEFAULT_TOPIC_CHUNK_CHARS;
  }

  const value = Number(rawValue.trim());
  if (
    !Number.isInteger(value) ||
    value < MIN_TOPIC_CHUNK_CHARS ||
    value > MAX_TOPIC_CHUNK_CHARS
  ) {
    throw new Error(
      `TOPIC_CHUNK_CHARS must be an integer from ${MIN_TOPIC_CHUNK_CHARS} to ${MAX_TOPIC_CHUNK_CHARS}.`,
    );
  }

  return value;
}

export function getGeminiEmbeddingModel(): string {
  const configuredModel = process.env.GEMINI_EMBEDDING_MODEL;

  if (configuredModel === undefined) {
    return DEFAULT_GEMINI_EMBEDDING_MODEL;
  }

  const model = configuredModel.trim();
  if (!model) {
    throw new Error("GEMINI_EMBEDDING_MODEL must not be blank.");
  }

  return model;
}

export function getGeminiEmbeddingDimensions(): number {
  const rawValue = process.env.GEMINI_EMBEDDING_DIMENSIONS;

  if (rawValue === undefined) {
    return DEFAULT_GEMINI_EMBEDDING_DIMENSIONS;
  }

  const value = Number(rawValue.trim());
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_GEMINI_EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `GEMINI_EMBEDDING_DIMENSIONS must be an integer from 1 to ${MAX_GEMINI_EMBEDDING_DIMENSIONS}.`,
    );
  }

  return value;
}

function readPositiveNumber(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of megabytes.`);
  }

  return value;
}

export function getUploadLimits(): UploadLimits {
  const videoMaxSizeMb = readPositiveNumber(
    "VIDEO_MAX_SIZE_MB",
    DEFAULT_VIDEO_MAX_SIZE_MB,
  );
  const pdfMaxSizeMb = readPositiveNumber(
    "PDF_MAX_SIZE_MB",
    DEFAULT_PDF_MAX_SIZE_MB,
  );

  return {
    videoMaxSizeMb,
    pdfMaxSizeMb,
    videoMaxSizeBytes: videoMaxSizeMb * MEBIBYTE,
    pdfMaxSizeBytes: pdfMaxSizeMb * MEBIBYTE,
  };
}

export function getAiTranscriptionTimeoutMs(): number {
  return (
    readPositiveNumber(
      "AI_TRANSCRIPTION_TIMEOUT_SECONDS",
      DEFAULT_AI_TRANSCRIPTION_TIMEOUT_SECONDS,
    ) * 1000
  );
}

export function validateServerEnv(): void {
  requireServerEnv("DATABASE_URL");
  getAiServiceUrl();
  getGeminiApiKey();
  getGeminiTopicModel();
  getTopicChunkChars();
  getGeminiEmbeddingModel();
  getGeminiEmbeddingDimensions();
  getUploadLimits();
  getAiTranscriptionTimeoutMs();
}
