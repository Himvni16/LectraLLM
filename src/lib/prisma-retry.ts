import "server-only";

import { Prisma } from "@prisma/client";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1_500;
const RETRYABLE_PRISMA_CODES = new Set(["P1001"]);

interface RetryLogger {
  warn(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

interface PrismaRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  logger?: RetryLogger;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getPrismaErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ?? null;
  }

  return null;
}

export function isRetryablePrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  return code !== null && RETRYABLE_PRISMA_CODES.has(code);
}

export async function withPrismaRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
  options: PrismaRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const wait = options.sleep ?? sleep;
  const logger = options.logger ?? console;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Prisma retry maxAttempts must be a positive integer.");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("Prisma retry delayMs must be non-negative.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = getPrismaErrorCode(error);

      if (!isRetryablePrismaError(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        logger.error("Transient Prisma connection retries exhausted.", {
          operation: operationName,
          code,
          attempts: maxAttempts,
        });
        throw error;
      }

      logger.warn("Transient Prisma connection failure; retrying.", {
        operation: operationName,
        code,
        attempt,
        maxAttempts,
        delayMs,
      });
      await wait(delayMs);
    }
  }

  throw new Error("Prisma retry loop ended unexpectedly.");
}
