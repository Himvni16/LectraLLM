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
    LabelList: container("LabelList"),
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

const extractedTopics = [
  {
    id: "video-1",
    name: "Deadlocks",
    source: "VIDEO",
    confidence: 0.95,
  },
  {
    id: "pdf-extracted-1",
    name: "PDF Extraction Topic",
    source: "PDF",
    confidence: 0.9,
  },
];

const sourceDetails = {
  transcriptText: "Lecture transcript body",
  pdfText: "PDF source text body",
};

function analysis(status: string) {
  return {
    id: "analysis-1",
    videoFileName: "lecture.mp4",
    pdfFileName: "notes.pdf",
    status,
    transcriptText: sourceDetails.transcriptText,
    pdfText: sourceDetails.pdfText,
    overallSimilarityScore: 50,
    topics: extractedTopics,
    comparisonMatches: [strongMatch, missingMatch],
  };
}

function renderDashboard(
  options: {
    initialTab?: "overview" | "topics" | "sources";
    initialExtractedTopicSource?: "VIDEO" | "PDF";
    matches?: DashboardMatch[];
  } = {},
) {
  return renderToStaticMarkup(
    React.createElement(AnalysisDashboard, {
      extractedTopics,
      matches: options.matches ?? [strongMatch, missingMatch],
      overallSimilarityScore: 50,
      sourceDetails,
      initialTab: options.initialTab,
      initialExtractedTopicSource: options.initialExtractedTopicSource,
    }),
  );
}

describe("analysis dashboard rendering", () => {
  it("keeps the completed header and four primary metrics above the tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(TranscriptionPanel, {
        initialAnalysis: analysis("COMPLETED"),
      }),
    );

    expect(html).toContain("Completed analysis");
    expect(html).toContain("Lecture Analysis");
    expect(html).toContain("lecture.mp4");
    expect(html).toContain("notes.pdf");
    expect(html).toContain("Analysis complete");
    expect(html.match(/data-primary-metric/g)).toHaveLength(4);
    expect(html).toContain("Overall Match");
    expect(html).toContain("50.0%");
    expect(html).toContain("Topic Coverage");
    expect(html).toContain("50%");
    expect(html).toContain("Strong Matches");
    expect(html).toContain("1 / 2");
    expect(html).toContain("Missing Topics");
    expect(html).not.toContain("1 strong • 0 partial • 0 weak");
    expect(html).not.toContain("2 PDF topics analyzed");
  });

  it("uses Overview as the default and excludes topic and source details", () => {
    const html = renderDashboard();

    expect(html).toContain('role="tablist"');
    expect(html).toMatch(
      /aria-selected="true"[^>]*id="dashboard-tab-overview"/,
    );
    expect(html).toContain('id="dashboard-panel-overview"');
    expect(html).toContain("Lecture–PDF Alignment");
    expect(html).toContain("Overall lecture-to-PDF alignment: 50.0%");
    expect(html).toContain("1 of 2 PDF topics are covered.");
    expect(html).toMatch(/data-alignment-score="true"[^>]*>50\.0%<\/span>/);
    expect(html).not.toContain(
      'class="mt-5 text-3xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-4xl"',
    );
    expect(html).not.toContain("1 strong • 0 partial • 0 weak");
    expect(html).toContain("Match Distribution");
    expect(html).toContain("Strong: 1, Partial: 0, Weak: 0, Missing: 1");
    expect(html).not.toContain("PDF topics by stored match category.");
    expect(html).toContain('data-alignment-missing-topics="true"');
    expect(html).toContain("Memory Segmentation");
    expect(html).not.toContain('id="missing-topics-heading"');
    expect(html).not.toContain('id="topic-coverage-heading"');
    expect(html).not.toContain('id="extracted-topics-heading"');
    expect(html).not.toContain('id="analysis-metadata-heading"');
    expect(html).not.toContain('id="source-text-heading"');
  });

  it("shows compact Topic Coverage and lecture topics in Topic Analysis", () => {
    const html = renderDashboard({ initialTab: "topics" });

    expect(html).toMatch(
      /aria-selected="true"[^>]*id="dashboard-tab-topics"/,
    );
    expect(html).toContain('id="dashboard-panel-topics"');
    expect(html).toContain('id="topic-coverage-heading"');
    expect(html).toContain("Deadlock Prevention");
    expect(html).toContain("80.0%");
    expect(html).toContain("Memory Segmentation");
    expect(html).toContain("20.0%");
    expect(html).not.toContain("Best lecture match");
    expect(html).not.toContain("No lecture match");
    expect(html).toContain('id="extracted-topics-heading"');
    expect(html).toContain('aria-labelledby="extracted-tab-VIDEO"');
    expect(html).toContain("1 extracted topic");
    expect(html).toContain("Deadlocks");
    expect(html).toContain("Confidence 95%");
    expect(html).not.toContain("PDF Extraction Topic");
    expect(html).not.toContain("Lecture–PDF Alignment");
  });

  it("switches the extracted-topic panel to PDF topics", () => {
    const html = renderDashboard({
      initialTab: "topics",
      initialExtractedTopicSource: "PDF",
    });

    expect(html).toMatch(/aria-selected="true"[^>]*id="extracted-tab-PDF"/);
    expect(html).toContain('aria-labelledby="extracted-tab-PDF"');
    expect(html).toContain("PDF Extraction Topic");
    expect(html).toContain("Confidence 90%");
    expect(html).not.toContain("Deadlocks");
  });

  it("shows collapsed raw sources without metadata or technical details", () => {
    const html = renderDashboard({ initialTab: "sources" });

    expect(html).toMatch(
      /aria-selected="true"[^>]*id="dashboard-tab-sources"/,
    );
    expect(html).toContain('id="dashboard-panel-sources"');
    expect(html).not.toContain("Analysis Metadata");
    expect(html).not.toContain("Video filename");
    expect(html).not.toContain("PDF filename");
    expect(html).not.toContain("Status");
    expect(html).not.toContain("lecture.mp4");
    expect(html).not.toContain("notes.pdf");
    expect(html).not.toContain("Technical details");
    expect(html).not.toContain("Analysis ID");
    expect(html).not.toContain("analysis-1");
    expect(html).toMatch(/<details><summary[^>]*>Lecture transcript<\/summary>/);
    expect(html).toMatch(/<details><summary[^>]*>Extracted PDF text<\/summary>/);
    expect(html).not.toMatch(/<details open/);
    expect(html).not.toContain('id="topic-coverage-heading"');
    expect(html).not.toContain("Match Distribution");
  });

  it("renders a compact zero-missing state on Overview", () => {
    const html = renderDashboard({ matches: [strongMatch] });

    expect(html).toContain("1 of 1 PDF topic is covered.");
    expect(html).toContain("No missing PDF topics");
    expect(html).not.toContain('data-alignment-missing-topics="true"');
    expect(html).not.toContain('id="missing-topics-heading"');
  });

  it("does not render the completed dashboard before completion", () => {
    const html = renderToStaticMarkup(
      React.createElement(TranscriptionPanel, {
        initialAnalysis: analysis("COMPARING"),
      }),
    );

    expect(html).not.toContain("Lecture–PDF Alignment");
    expect(html).not.toContain("Analysis complete");
    expect(html).not.toContain("Analysis dashboard sections");
    expect(html).toContain("Analyzing your lecture");
    expect(html).toContain("Comparing lecture and PDF");
    expect(html).not.toContain("Compare Lecture &amp; PDF");
    expect(html).not.toContain("Transcribe lecture");
  });

  it("keeps the failed-state retry behavior unchanged", () => {
    const html = renderToStaticMarkup(
      React.createElement(TranscriptionPanel, {
        initialAnalysis: analysis("FAILED"),
      }),
    );

    expect(html).toContain("Retry Analysis");
    expect(html).toContain("retry from where it stopped");
    expect(html).not.toContain("Retry transcription");
    expect(html).not.toContain("Retry PDF extraction");
    expect(html).not.toContain("Retry topic extraction");
  });
});
