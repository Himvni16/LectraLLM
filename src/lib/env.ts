import "server-only";

type ServerEnvName = "DATABASE_URL" | "AI_SERVICE_URL";

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
  getUploadLimits();
  getAiTranscriptionTimeoutMs();
}
