import "server-only";

import { getAiServiceUrl } from "@/lib/env";

export interface AiServiceHealth {
  status: string;
  service: string;
}

export async function getAiServiceHealth(): Promise<AiServiceHealth> {
  const response = await fetch(`${getAiServiceUrl()}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`AI service health check failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AiServiceHealth;
}

