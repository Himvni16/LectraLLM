import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAiServiceHealth: vi.fn(),
}));

vi.mock("@/lib/ai-service", () => ({
  getAiServiceHealth: mocks.getAiServiceHealth,
}));

import { GET } from "@/app/api/ai-health/route";

describe("GET /api/ai-health", () => {
  beforeEach(() => {
    mocks.getAiServiceHealth.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("proxies a healthy FastAPI response", async () => {
    mocks.getAiServiceHealth.mockResolvedValue({
      status: "ok",
      service: "lectrallm-ai",
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "lectrallm-ai",
    });
  });

  it("returns a safe 503 when FastAPI is unavailable", async () => {
    mocks.getAiServiceHealth.mockRejectedValue(
      new Error("connect ECONNREFUSED http://private-ai:8000 secret=abc"),
    );

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "unavailable",
      service: "lectrallm-ai",
      message: "The AI service health check is unavailable.",
    });
    expect(JSON.stringify(body)).not.toContain("private-ai");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
