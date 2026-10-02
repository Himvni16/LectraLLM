import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  isRetryablePrismaError,
  withPrismaRetry,
} from "@/lib/prisma-retry";

function initializationError(code: string) {
  return new Prisma.PrismaClientInitializationError(
    "Database connection failed at a private endpoint.",
    "6.12.0",
    code,
  );
}

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Prisma request failed.", {
    code,
    clientVersion: "6.12.0",
  });
}

function createOptions() {
  return {
    sleep: vi.fn(async () => undefined),
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("Prisma transient connection retry", () => {
  it("returns immediately when the first attempt succeeds", async () => {
    const operation = vi.fn(async () => "connected");
    const options = createOptions();

    await expect(
      withPrismaRetry("analysis.load", operation, options),
    ).resolves.toBe("connected");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(options.sleep).not.toHaveBeenCalled();
    expect(options.logger.warn).not.toHaveBeenCalled();
  });

  it("retries P1001 initialization failures and then succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(initializationError("P1001"))
      .mockRejectedValueOnce(initializationError("P1001"))
      .mockResolvedValue("awake");
    const options = createOptions();

    await expect(
      withPrismaRetry("analysis.load", operation, options),
    ).resolves.toBe("awake");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(options.sleep).toHaveBeenCalledTimes(2);
    expect(options.sleep).toHaveBeenNthCalledWith(1, 1_500);
    expect(options.logger.warn).toHaveBeenCalledTimes(2);
    expect(options.logger.warn.mock.calls[0]?.[1]).toEqual({
      operation: "analysis.load",
      code: "P1001",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1_500,
    });
  });

  it("recognizes P1001 known-request errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(knownRequestError("P1001"))
      .mockResolvedValue("connected");
    const options = createOptions();

    await expect(
      withPrismaRetry("analysis.update", operation, options),
    ).resolves.toBe("connected");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(options.sleep).toHaveBeenCalledTimes(1);
  });

  it("stops after three P1001 attempts and rethrows the original error", async () => {
    const error = initializationError("P1001");
    const operation = vi.fn(async () => {
      throw error;
    });
    const options = createOptions();

    await expect(
      withPrismaRetry("analysis.create", operation, options),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(options.sleep).toHaveBeenCalledTimes(2);
    expect(options.logger.error).toHaveBeenCalledWith(
      "Transient Prisma connection retries exhausted.",
      {
        operation: "analysis.create",
        code: "P1001",
        attempts: 3,
      },
    );
  });

  it.each([
    ["P1002 initialization error", initializationError("P1002")],
    ["P2002 request error", knownRequestError("P2002")],
    ["ordinary application error", new Error("Validation failed")],
  ])("does not retry an unrelated %s", async (_label, error) => {
    const operation = vi.fn(async () => {
      throw error;
    });
    const options = createOptions();

    await expect(
      withPrismaRetry("analysis.create", operation, options),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(options.sleep).not.toHaveBeenCalled();
    expect(options.logger.warn).not.toHaveBeenCalled();
    expect(options.logger.error).not.toHaveBeenCalled();
  });

  it("does not include raw database error details in retry logs", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(initializationError("P1001"))
      .mockResolvedValue("connected");
    const options = createOptions();

    await withPrismaRetry("analysis.load", operation, options);

    expect(JSON.stringify(options.logger.warn.mock.calls)).not.toContain(
      "private endpoint",
    );
    expect(isRetryablePrismaError(initializationError("P1001"))).toBe(true);
    expect(isRetryablePrismaError(initializationError("P1002"))).toBe(false);
  });
});
