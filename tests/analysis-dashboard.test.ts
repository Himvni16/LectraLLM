import { describe, expect, it } from "vitest";

import {
  deriveAnalysisDashboard,
  type DashboardMatch,
} from "@/lib/analysis-dashboard";

function match(
  pdfTopicId: string,
  similarityScore: number,
  matchType: DashboardMatch["matchType"],
): DashboardMatch {
  return {
    pdfTopicId,
    pdfTopicName: `PDF ${pdfTopicId}`,
    videoTopicId: matchType === "MISSING" ? null : `video-${pdfTopicId}`,
    videoTopicName: matchType === "MISSING" ? null : `Video ${pdfTopicId}`,
    similarityScore,
    matchType,
  };
}

describe("analysis dashboard calculations", () => {
  it("handles zero topics without dividing by zero", () => {
    const dashboard = deriveAnalysisDashboard([], null);

    expect(dashboard).toMatchObject({
      overallSimilarityPercentage: 0,
      coveragePercentage: 0,
      totalPdfTopics: 0,
      coveredTopics: 0,
      counts: { STRONG: 0, PARTIAL: 0, WEAK: 0, MISSING: 0 },
      topicRows: [],
      missingTopics: [],
    });
  });

  it("reports full coverage when every topic is STRONG", () => {
    const dashboard = deriveAnalysisDashboard(
      [match("one", 0.95, "STRONG"), match("two", 0.8, "STRONG")],
      87.5,
    );

    expect(dashboard.totalPdfTopics).toBe(2);
    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBe(100);
    expect(dashboard.overallSimilarityPercentage).toBe(87.5);
    expect(dashboard.counts).toEqual({
      STRONG: 2,
      PARTIAL: 0,
      WEAK: 0,
      MISSING: 0,
    });
  });

  it("reports full coverage when every topic is STRONG or PARTIAL", () => {
    const dashboard = deriveAnalysisDashboard(
      [match("strong", 0.91, "STRONG"), match("partial", 0.65, "PARTIAL")],
      78,
    );

    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBe(100);
  });

  it("does not count WEAK topics as covered", () => {
    const dashboard = deriveAnalysisDashboard(
      [
        match("strong", 0.91, "STRONG"),
        match("partial", 0.65, "PARTIAL"),
        match("weak", 0.42, "WEAK"),
      ],
      66,
    );

    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBeCloseTo(66.666_666_666_7);
  });

  it("does not count MISSING topics as covered", () => {
    const dashboard = deriveAnalysisDashboard(
      [
        match("strong", 0.91, "STRONG"),
        match("partial", 0.65, "PARTIAL"),
        match("missing", 0.2, "MISSING"),
      ],
      60,
    );

    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBeCloseTo(66.666_666_666_7);
  });

  it("excludes both WEAK and MISSING topics from coverage", () => {
    const dashboard = deriveAnalysisDashboard(
      [
        match("strong", 0.91, "STRONG"),
        match("partial", 0.65, "PARTIAL"),
        match("weak", 0.42, "WEAK"),
        match("missing", 0.2, "MISSING"),
      ],
      52.5,
    );

    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBe(50);
  });

  it("derives mixed counts, coverage, and topic rows in source order", () => {
    const matches = [
      match("strong", 0.91, "STRONG"),
      match("partial", 0.65, "PARTIAL"),
      match("weak", 0.42, "WEAK"),
      match("missing", 0.12, "MISSING"),
    ];

    const dashboard = deriveAnalysisDashboard(matches, 52.5);

    expect(dashboard.counts).toEqual({
      STRONG: 1,
      PARTIAL: 1,
      WEAK: 1,
      MISSING: 1,
    });
    expect(dashboard.coveredTopics).toBe(2);
    expect(dashboard.coveragePercentage).toBe(50);
    expect(dashboard.topicRows.map((topic) => topic.pdfTopicId)).toEqual([
      "strong",
      "partial",
      "weak",
      "missing",
    ]);
    expect(
      dashboard.topicRows.map((topic) => topic.similarityPercentage),
    ).toEqual([91, 65, 42, 12]);
    expect(dashboard.distribution.map(({ matchType, count }) => ({
      matchType,
      count,
    }))).toEqual([
      { matchType: "STRONG", count: 1 },
      { matchType: "PARTIAL", count: 1 },
      { matchType: "WEAK", count: 1 },
      { matchType: "MISSING", count: 1 },
    ]);
  });

  it("reports zero coverage when every topic is MISSING", () => {
    const dashboard = deriveAnalysisDashboard(
      [match("one", 0.1, "MISSING"), match("two", 0.2, "MISSING")],
      15,
    );

    expect(dashboard.coveragePercentage).toBe(0);
    expect(dashboard.coveredTopics).toBe(0);
    expect(dashboard.counts.MISSING).toBe(2);
    expect(dashboard.missingTopics).toHaveLength(2);
  });
});
