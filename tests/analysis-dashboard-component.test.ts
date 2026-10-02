import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", async () => {
  const react = await import("react");
  const container =
    (name: string) =>
    ({ children }: { children?: ReactNode }) =>
      react.createElement("div", { "data-chart-component": name }, children);

  return {
    Bar: container("Bar"),
    BarChart: container("BarChart"),
    CartesianGrid: container("CartesianGrid"),
    Cell: container("Cell"),
    ResponsiveContainer: container("ResponsiveContainer"),
    Tooltip: container("Tooltip"),
    XAxis: container("XAxis"),
    YAxis: container("YAxis"),
  };
});

import { AnalysisDashboard } from "@/components/analysis-dashboard";
import { TranscriptionPanel } from "@/components/transcription-panel";
import type { DashboardMatch } from "@/lib/analysis-dashboard";

const strongMatch: DashboardMatch = {
  pdfTopicId: "pdf-1",
  pdfTopicName: "Deadlock Prevention",
  videoTopicId: "video-1",
  videoTopicName: "Deadlocks",
  similarityScore: 0.8,
  matchType: "STRONG",
};

const missingMatch: DashboardMatch = {
  pdfTopicId: "pdf-2",
  pdfTopicName: "Memory Segmentation",
  videoTopicId: null,
  videoTopicName: null,
  similarityScore: 0.2,
  matchType: "MISSING",
};

function analysis(status: string) {
  return {
    id: "analysis-1",
    videoFileName: "lecture.mp4",
    pdfFileName: "notes.pdf",
    status,
    transcriptText: "Lecture transcript",
    pdfText: "PDF source text",
    overallSimilarityScore: 50,
    topics: [
      {
        id: "video-1",
        name: "Deadlocks",
        source: "VIDEO",
        confidence: 0.95,
      },
      {
        id: "pdf-1",
        name: "Deadlock Prevention",
        source: "PDF",
        confidence: 0.9,
      },
    ],
    comparisonMatches: [strongMatch, missingMatch],
  };
}

describe("analysis dashboard rendering", () => {
  it("renders the completed dashboard and detailed missing comparison", () => {
    const html = renderToStaticMarkup(
      React.createElement(TranscriptionPanel, {
        initialAnalysis: analysis("COMPLETED"),
      }),
    );

    expect(html).toContain("Analysis dashboard");
    expect(html).toContain("Overall similarity");
    expect(html).toContain("50.00%");
    expect(html).toContain("Missing Topics");
    expect(html).toContain("Memory Segmentation");
    expect(html).toContain("No lecture match");
    expect(html).toContain("Detailed topic comparison");
    expect(html).toContain("Lecture topics");
    expect(html).toContain("PDF topics and subtopics");
    expect(html).toContain("Source text");
  });

  it("renders the no-missing-topics state", () => {
    const html = renderToStaticMarkup(
      React.createElement(AnalysisDashboard, {
        matches: [strongMatch],
        overallSimilarityScore: 80,
      }),
    );

    expect(html).toContain("All PDF topics have a lecture match.");
    expect(html).toContain("Best lecture match: Deadlocks");
  });

  it("does not render the dashboard before completion", () => {
    const html = renderToStaticMarkup(
      React.createElement(TranscriptionPanel, {
        initialAnalysis: analysis("COMPARING"),
      }),
    );

    expect(html).not.toContain("Analysis dashboard");
    expect(html).toContain("Compare Lecture &amp; PDF");
    expect(html).toContain("Lecture transcript");
  });
});
