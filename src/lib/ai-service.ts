import "server-only";

import { getAiServiceUrl } from "@/lib/env";

export interface AiServiceHealth {
  status: string;
  service: string;
}

export class AiServiceHealthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiServiceHealthError";
  }
}

function isAiServiceHealth(value: unknown): value is AiServiceHealth {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const health = value as Record<string, unknown>;
  return typeof health.status === "string" && typeof health.service === "string";
}

export async function getAiServiceHealth(): Promise<AiServiceHealth> {
  let response: Response;

  try {
    response = await fetch(`${getAiServiceUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new AiServiceHealthError("The AI service is unavailable.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new AiServiceHealthError("The AI service health check failed.");
  }

  try {
    const health: unknown = await response.json();

    if (!isAiServiceHealth(health)) {
      throw new Error("Unexpected health response shape.");
    }

    return health;
  } catch (error) {
    throw new AiServiceHealthError(
      "The AI service returned an invalid health response.",
      { cause: error },
    );
  }
}
