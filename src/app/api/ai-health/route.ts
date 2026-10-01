import { NextResponse } from "next/server";

import { getAiServiceHealth } from "@/lib/ai-service";

export async function GET() {
  try {
    const health = await getAiServiceHealth();
    return NextResponse.json(health);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI service is unavailable.";

    return NextResponse.json(
      {
        status: "unavailable",
        service: "lectrallm-ai",
        message,
      },
      { status: 503 },
    );
  }
}
