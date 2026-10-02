import { TopicSource } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiTopicExtractionClient } from "@/lib/topic-extraction/ai-client";

describe("AI topic extraction client", () => {
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_SERVICE_URL;
  });

  it("sends source text and accepts structured topics", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          topics: [{ name: "  Deadlocks  ", confidence: 0.95 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createAiTopicExtractionClient().extract(
      "Lecture transcript",
      TopicSource.VIDEO,
    );

    expect(result).toEqual({
      topics: [{ name: "Deadlocks", confidence: 0.95 }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/extract-topics",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Lecture transcript",
          source: TopicSource.VIDEO,
        }),
        cache: "no-store",
      }),
    );
  });

  it("rejects malformed provider output with a safe error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          topics: [{ name: "Deadlocks", confidence: 12 }],
          privateDetail: "sk-private",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createAiTopicExtractionClient().extract("PDF text", TopicSource.PDF),
    ).rejects.toMatchObject({
      name: "TopicExtractionClientError",
      message: "The topic extraction service returned an invalid response.",
    });
  });
});
