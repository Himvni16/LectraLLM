import { NextResponse } from "next/server";

import { getAiServiceHealth } from "@/lib/ai-service";

export async function GET() {
  try {
    const health = await getAiServiceHealth();
    return NextResponse.json(health);
  } catch (error) {
    console.error("AI service health check failed.", error);

    return NextResponse.json(
      {
        status: "unavailable",
        service: "lectrallm-ai",
        message: "The AI service health check is unavailable.",
      },
      { status: 503 },
    );
  }
}
