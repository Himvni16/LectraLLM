import type { GenerateContentParameters } from "@google/genai";
import { TopicSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  chunkTopicText,
  createGeminiTopicExtractionClient,
  mergeTopicResults,
} from "@/lib/topic-extraction/gemini-client";

const TEST_OPTIONS = {
  model: "gemini-test-flash",
  maxChunkChars: 12_000,
  timeoutMs: 1_000,
};

const SHARED_TOPIC_NAMING_GUIDANCE =
  "Each topic must represent one primary concept, feature, process, technique, or subject.";

describe("Gemini topic extraction client", () => {
  it("sends a short VIDEO source with source-specific and shared naming guidance", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return {
          text: JSON.stringify({
            topics: [{ name: "Deadlocks", confidence: 0.95 }],
          }),
        };
      },
    );

    const result = await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      generateContent,
    }).extract("Lecture transcript", TopicSource.VIDEO);

    expect(result).toEqual({
      topics: [{ name: "Deadlocks", confidence: 0.95 }],
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-test-flash",
      contents:
        "Source type: VIDEO\n\nExtract structured topics from this source text:\n\nLecture transcript",
      config: expect.objectContaining({
        systemInstruction: expect.stringContaining(
          "Extract only topics clearly discussed in the lecture transcript.",
        ),
        responseMimeType: "application/json",
        responseJsonSchema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
        }),
        temperature: 0,
        automaticFunctionCalling: { disable: true },
      }),
    });
    expect(
      generateContent.mock.calls[0]?.[0].config?.systemInstruction,
    ).toEqual(expect.stringContaining(SHARED_TOPIC_NAMING_GUIDANCE));
  });

  it("requires compound concepts to be separated into atomic topics", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return {
          text: JSON.stringify({
            topics: [
              { name: "Video Analysis", confidence: 0.9 },
              { name: "Audio Transcription", confidence: 0.9 },
            ],
          }),
        };
      },
    );

    const result = await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      generateContent,
    }).extract(
      "The system performs video analysis and audio transcription.",
      TopicSource.VIDEO,
    );
    const instruction =
      generateContent.mock.calls[0]?.[0].config?.systemInstruction;

    expect(instruction).toContain(
      "Do not combine multiple independently meaningful concepts into one topic",
    );
    expect(instruction).toContain(
      "return them as separate topics",
    );
    expect(instruction).toContain(
      "Video Analysis; Audio Transcription",
    );
    expect(instruction).toContain(
      "PDF Content Processing; Semantic Analysis",
    );
    expect(instruction).toContain(
      "Student Engagement Analysis; Sentiment Analysis",
    );
    expect(result.topics.map((topic) => topic.name)).toEqual([
      "Video Analysis",
      "Audio Transcription",
    ]);
  });

  it("preserves established technical multiword concepts", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return {
          text: JSON.stringify({
            topics: [
              { name: "Learning Management System", confidence: 0.95 },
              { name: "Natural Language Processing", confidence: 0.9 },
              { name: "Large Language Model", confidence: 0.9 },
            ],
          }),
        };
      },
    );

    const result = await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      generateContent,
    }).extract("Technical source", TopicSource.PDF);
    const instruction =
      generateContent.mock.calls[0]?.[0].config?.systemInstruction;

    expect(instruction).toContain(
      "Do not split concepts that are inherently one established term",
    );
    expect(result.topics.map((topic) => topic.name)).toEqual([
      "Learning Management System",
      "Natural Language Processing",
      "Large Language Model",
    ]);
  });

  it("keeps generic labels grounded and disallows them by themselves", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return {
          text: JSON.stringify({
            topics: [
              {
                name: "Lecture-PDF Content Validation Problem",
                confidence: 0.9,
              },
            ],
          }),
        };
      },
    );

    await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      generateContent,
    }).extract("Problem statement about content validation", TopicSource.PDF);
    const instruction =
      generateContent.mock.calls[0]?.[0].config?.systemInstruction;

    for (const label of [
      "Introduction",
      "Conclusion",
      "Summary",
      "Overview",
      "Problem Statement",
      "Project Objective",
    ]) {
      expect(instruction).toContain(label);
    }
    expect(instruction).toContain(
      "using only information present in the source text",
    );
    expect(instruction).toContain("do not invent concepts");
  });

  it("uses the PDF-specific instruction without changing the output contract", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return {
          text: JSON.stringify({ topics: [{ name: "Indexing" }] }),
        };
      },
    );

    const result = await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      generateContent,
    }).extract("PDF source text", TopicSource.PDF);

    expect(result).toEqual({
      topics: [{ name: "Indexing", confidence: null }],
    });
    expect(generateContent.mock.calls[0]?.[0].config?.systemInstruction).toContain(
      "Extract useful PDF topics and subtopics that are present in the text.",
    );
  });

  it("chunks deterministically at paragraph, sentence, then word boundaries", () => {
    expect(
      chunkTopicText(
        "  First paragraph.  \r\n \r\n  Second sentence is oversized for this limit.  ",
        22,
      ),
    ).toEqual([
      "First paragraph.",
      "Second sentence is",
      "oversized for this",
      "limit.",
    ]);
  });

  it("keeps every source character in deterministic bounded chunks", () => {
    const text =
      "Deadlocks occur when processes wait for resources. " +
      "Mutual exclusion is one necessary condition.\n\n" +
      "Deadlock prevention breaks at least one necessary condition. " +
      "Resource ordering can prevent circular wait.";

    const chunks = chunkTopicText(text, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 80)).toBe(true);
    expect(chunks.join(" ").split(/\s+/u).join(" ")).toBe(
      text.split(/\s+/u).join(" "),
    );
  });

  it("does not cut an individual word that exceeds the chunk limit", () => {
    const longTerm = "pneumonoultramicroscopicsilicovolcanoconiosis";
    const chunks = chunkTopicText(`Topic ${longTerm} discussed`, 20);

    expect(chunks).toContain(longTerm);
    expect(chunks.join(" ")).toBe(`Topic ${longTerm} discussed`);
  });

  it("merges duplicates across chunks with first-seen order and maximum confidence", async () => {
    const responses = [
      {
        topics: [
          { name: "  Audio Transcription. ", confidence: 0.4 },
          { name: "Video Analysis", confidence: null },
        ],
      },
      {
        topics: [
          { name: "audio transcription!!!", confidence: 0.91 },
          { name: "Semantic Analysis", confidence: 0.8 },
        ],
      },
    ];
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return { text: JSON.stringify(responses.shift()) };
      },
    );

    const result = await createGeminiTopicExtractionClient({
      ...TEST_OPTIONS,
      maxChunkChars: 40,
      generateContent,
    }).extract(
      "Audio transcription is discussed.\n\nSemantic analysis is discussed.",
      TopicSource.VIDEO,
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      topics: [
        { name: "Audio Transcription", confidence: 0.91 },
        { name: "Video Analysis", confidence: null },
        { name: "Semantic Analysis", confidence: 0.8 },
      ],
    });
  });

  it("keeps duplicate merging literal rather than semantic", () => {
    expect(
      mergeTopicResults([
        { topics: [{ name: "Audio Transcription", confidence: 0.9 }] },
        {
          topics: [
            { name: "audio transcription", confidence: 0.8 },
            { name: "Speech Audio Transcription", confidence: 0.85 },
          ],
        },
      ]),
    ).toEqual({
      topics: [
        { name: "Audio Transcription", confidence: 0.9 },
        { name: "Speech Audio Transcription", confidence: 0.85 },
      ],
    });
  });

  it("preserves a valid empty extracted-topic response", async () => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return { text: '{"topics":[]}' };
      },
    );

    await expect(
      createGeminiTopicExtractionClient({
        ...TEST_OPTIONS,
        generateContent,
      }).extract("Source without academic topics", TopicSource.VIDEO),
    ).resolves.toEqual({ topics: [] });
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["out-of-range confidence", '{"topics":[{"name":"A","confidence":2}]}'],
    ["extra response data", '{"topics":[],"privateDetail":"secret"}'],
  ])("rejects %s with a safe error", async (_label, text) => {
    const generateContent = vi.fn(
      async (parameters: GenerateContentParameters) => {
        void parameters;
        return { text };
      },
    );

    await expect(
      createGeminiTopicExtractionClient({
        ...TEST_OPTIONS,
        generateContent,
      }).extract("PDF text", TopicSource.PDF),
    ).rejects.toMatchObject({
      name: "TopicExtractionClientError",
      message: "The topic extraction service returned an invalid response.",
    });
  });

  it("converts Gemini failures into a safe client error", async () => {
    const generateContent = vi.fn(async (parameters: GenerateContentParameters) => {
      void parameters;
      throw new Error("provider detail that must remain server-side");
    });

    await expect(
      createGeminiTopicExtractionClient({
        ...TEST_OPTIONS,
        generateContent,
      }).extract("Lecture text", TopicSource.VIDEO),
    ).rejects.toMatchObject({
      name: "TopicExtractionClientError",
      message: "The topic extraction service could not process the source text.",
    });
  });
});
