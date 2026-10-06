import { describe, expect, it } from "vitest";

import { classifyTranscriptionError } from "@/lib/transcription/errors";

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error("safe test failure"), { code });
}

describe("transcription error classification", () => {
  it.each([
    [{ status: 429 }, "RATE_LIMIT"],
    [{ status: 500 }, "PROVIDER_5XX"],
    [{ statusCode: 503 }, "PROVIDER_5XX"],
    [errorWithCode("ETIMEDOUT"), "PROVIDER_TIMEOUT"],
    [errorWithCode("ECONNRESET"), "NETWORK_RESET"],
    [errorWithCode("UND_ERR_SOCKET"), "NETWORK_FAILURE"],
    [new TypeError("fetch failed"), "NETWORK_FAILURE"],
  ] as const)("classifies a retryable %o safely", (error, category) => {
    expect(classifyTranscriptionError(error)).toEqual({
      category,
      retryable: true,
    });
  });

  it("finds a retryable network code through a safe error cause chain", () => {
    expect(
      classifyTranscriptionError(
        new Error("request failed", { cause: errorWithCode("ECONNRESET") }),
      ),
    ).toEqual({ category: "NETWORK_RESET", retryable: true });
  });

  it("keeps unknown and malformed failures terminal", () => {
    expect(classifyTranscriptionError(new Error("invalid response"))).toEqual({
      category: "UNKNOWN",
      retryable: false,
    });
  });
});
