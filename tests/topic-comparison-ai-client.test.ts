import { MatchType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiTopicComparisonClient } from "@/lib/topic-comparison/ai-client";

const videoTopics = [{ id: "video-1", name: "Deadlocks" }];
const pdfTopics = [
  { id: "pdf-1", name: "Deadlock Prevention" },
  { id: "pdf-2", name: "Memory Segmentation" },
];

describe("AI topic comparison client", () => {
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_SERVICE_URL;
  });

  it("sends stable topic IDs and validates one result per PDF topic", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          matches: [
            {
              pdf_topic_id: "pdf-1",
              video_topic_id: "video-1",
              similarity_score: 0.82,
              match_type: MatchType.STRONG,
            },
            {
              pdf_topic_id: "pdf-2",
              video_topic_id: null,
              similarity_score: 0.12,
              match_type: MatchType.MISSING,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createAiTopicComparisonClient().compare(
      videoTopics,
      pdfTopics,
    );

    expect(result.matches).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/compare-topics",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          video_topics: videoTopics,
          pdf_topics: pdfTopics,
        }),
        cache: "no-store",
      }),
    );
  });

  it.each([
    {
      reason: "missing PDF result",
      matches: [
        {
          pdf_topic_id: "pdf-1",
          video_topic_id: "video-1",
          similarity_score: 0.82,
          match_type: MatchType.STRONG,
        },
      ],
    },
    {
      reason: "unknown video ID",
      matches: [
        {
          pdf_topic_id: "pdf-1",
          video_topic_id: "video-unknown",
          similarity_score: 0.82,
          match_type: MatchType.STRONG,
        },
        {
          pdf_topic_id: "pdf-2",
          video_topic_id: null,
          similarity_score: 0.1,
          match_type: MatchType.MISSING,
        },
      ],
    },
    {
      reason: "classification inconsistent with score",
      matches: [
        {
          pdf_topic_id: "pdf-1",
          video_topic_id: "video-1",
          similarity_score: 0.2,
          match_type: MatchType.STRONG,
        },
        {
          pdf_topic_id: "pdf-2",
          video_topic_id: null,
          similarity_score: 0.1,
          match_type: MatchType.MISSING,
        },
      ],
    },
  ])("rejects $reason", async ({ matches }) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ matches }), { status: 200 }),
    );

    await expect(
      createAiTopicComparisonClient().compare(videoTopics, pdfTopics),
    ).rejects.toMatchObject({
      name: "TopicComparisonClientError",
      message: "The topic comparison service returned an invalid response.",
    });
  });

  it("sanitizes FastAPI failures", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "private model path" }), {
        status: 500,
      }),
    );

    await expect(
      createAiTopicComparisonClient().compare(videoTopics, pdfTopics),
    ).rejects.toMatchObject({
      message: "The topic comparison service could not compare these topics.",
    });
  });
});
