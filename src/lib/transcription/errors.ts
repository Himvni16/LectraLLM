export type TranscriptionErrorCategory =
  | "RATE_LIMIT"
  | "PROVIDER_5XX"
  | "PROVIDER_TIMEOUT"
  | "NETWORK_RESET"
  | "NETWORK_FAILURE"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "PROVIDER_REQUEST_REJECTED"
  | "EMPTY_TRANSCRIPT"
  | "INVALID_CLOUDINARY_ASSET"
  | "PROVIDER_FILE_FAILED"
  | "UNKNOWN";

export interface TranscriptionErrorClassification {
  category: TranscriptionErrorCategory;
  retryable: boolean;
}

export class TranscriptionOperationError extends Error {
  constructor(
    message: string,
    public readonly category: TranscriptionErrorCategory,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TranscriptionOperationError";
  }
}

const NETWORK_FAILURE_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && !seen.has(current) && chain.length < 5) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return chain;
}

function numericStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  for (const key of ["status", "statusCode", "http_code"] as const) {
    const status = (value as Record<string, unknown>)[key];
    if (typeof status === "number" && Number.isInteger(status)) return status;
  }
  return null;
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : null;
}

function errorName(value: unknown): string {
  return value instanceof Error ? value.name.toLowerCase() : "";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message.toLowerCase() : "";
}

export function classifyTranscriptionError(
  error: unknown,
): TranscriptionErrorClassification {
  if (error instanceof TranscriptionOperationError) {
    return { category: error.category, retryable: error.retryable };
  }

  const chain = errorChain(error);
  const statuses = chain.map(numericStatus).filter((status) => status !== null);
  if (statuses.includes(429)) {
    return { category: "RATE_LIMIT", retryable: true };
  }
  if (statuses.some((status) => status >= 500 && status <= 599)) {
    return { category: "PROVIDER_5XX", retryable: true };
  }

  const codes = chain.map(errorCode).filter((code) => code !== null);
  if (codes.includes("ECONNRESET") || codes.includes("ECONNABORTED")) {
    return { category: "NETWORK_RESET", retryable: true };
  }
  if (
    codes.includes("ETIMEDOUT") ||
    chain.some((value) =>
      ["aborterror", "timeouterror"].includes(errorName(value)),
    ) ||
    chain.some((value) => /timed?\s*out|deadline/u.test(errorMessage(value)))
  ) {
    return { category: "PROVIDER_TIMEOUT", retryable: true };
  }
  if (
    codes.some((code) => NETWORK_FAILURE_CODES.has(code)) ||
    chain.some(
      (value) =>
        value instanceof TypeError &&
        /fetch failed|network|socket/u.test(errorMessage(value)),
    )
  ) {
    return { category: "NETWORK_FAILURE", retryable: true };
  }

  return { category: "UNKNOWN", retryable: false };
}

export function providerHttpError(status: number): TranscriptionOperationError {
  const classification = classifyTranscriptionError({ status });
  return new TranscriptionOperationError(
    "The transcription provider rejected the request.",
    classification.category === "UNKNOWN"
      ? "PROVIDER_REQUEST_REJECTED"
      : classification.category,
    classification.retryable,
  );
}
