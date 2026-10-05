import {
  AnalysisStatus,
  MatchType,
  Prisma,
  TopicSource,
  type Analysis,
  type Topic,
  type TopicMatch,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

const createdAt = new Date("2026-01-01T00:00:00.000Z");

describe("Phase 1 Prisma types", () => {
  it("represents an analysis and every processing status", () => {
    const analysis: Analysis = {
      id: "analysis-1",
      videoFileName: "lecture.mp4",
      pdfFileName: "notes.pdf",
      videoStoragePath: "development/lecture.mp4",
      pdfStoragePath: "development/notes.pdf",
      status: AnalysisStatus.UPLOADED,
      transcriptText: null,
      pdfText: null,
      overallSimilarityScore: new Prisma.Decimal("82.50"),
      processingToken: null,
      processingExpiresAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    expect(analysis.status).toBe(AnalysisStatus.UPLOADED);
    expect(Object.values(AnalysisStatus)).toEqual([
      "UPLOADED",
      "TRANSCRIBING",
      "EXTRACTING_PDF",
      "EXTRACTING_TOPICS",
      "COMPARING",
      "COMPLETED",
      "FAILED",
    ]);
  });

  it("represents topics from video and PDF sources", () => {
    const topics: Topic[] = [
      {
        id: "video-topic-1",
        analysisId: "analysis-1",
        name: "Deadlocks",
        source: TopicSource.VIDEO,
        confidenceScore: new Prisma.Decimal("0.9800"),
        createdAt,
      },
      {
        id: "pdf-topic-1",
        analysisId: "analysis-1",
        name: "Deadlocks",
        source: TopicSource.PDF,
        confidenceScore: null,
        createdAt,
      },
    ];

    expect(topics.map((topic) => topic.source)).toEqual([
      TopicSource.VIDEO,
      TopicSource.PDF,
    ]);
  });

  it("represents a topic match and every match type", () => {
    const topicMatch: TopicMatch = {
      id: "match-1",
      analysisId: "analysis-1",
      videoTopicId: null,
      pdfTopicId: "pdf-topic-1",
      similarityScore: new Prisma.Decimal("0.9700"),
      matchType: MatchType.STRONG,
      createdAt,
    };

    expect(topicMatch.videoTopicId).toBeNull();
    expect(topicMatch.similarityScore.toString()).toBe("0.97");
    expect(Object.values(MatchType)).toEqual([
      "STRONG",
      "PARTIAL",
      "WEAK",
      "MISSING",
    ]);
  });
});
