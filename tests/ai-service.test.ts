import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiServiceHealthError,
  getAiServiceHealth,
} from "@/lib/ai-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI service health client", () => {
  it("returns a validated FastAPI health response", async () => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "ok", service: "lectrallm-ai" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAiServiceHealth()).resolves.toEqual({
      status: "ok",
      service: "lectrallm-ai",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("maps network details to a safe unavailable error", async () => {
    process.env.AI_SERVICE_URL = "http://internal-ai:8000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.12:8000");
      }),
    );

    const error = await getAiServiceHealth().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AiServiceHealthError);
    expect((error as Error).message).toBe("The AI service is unavailable.");
    expect((error as Error).message).not.toContain("10.0.0.12");
  });

  it("rejects an unsuccessful or malformed response without exposing its body", async () => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";

    vi.stubGlobal("fetch", vi.fn(async () => new Response("private trace", { status: 500 })));
    await expect(getAiServiceHealth()).rejects.toThrow(
      "The AI service health check failed.",
    );

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ok" })));
    await expect(getAiServiceHealth()).rejects.toThrow(
      "The AI service returned an invalid health response.",
    );
  });
});
