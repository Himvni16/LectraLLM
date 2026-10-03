"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  deriveAnalysisDashboard,
  type AnalysisDashboardData,
  type DashboardMatch,
  type DashboardMatchType,
  type DashboardTopicRow,
} from "@/lib/analysis-dashboard";

export interface DashboardExtractedTopic {
  id?: string;
  name: string;
  source: string;
  confidence: number | null;
}

export interface DashboardSourceDetails {
  transcriptText: string | null;
  pdfText: string | null;
}

type DashboardTab = "overview" | "topics" | "sources";
type ExtractedTopicSource = "VIDEO" | "PDF";

interface AnalysisDashboardProps {
  matches: readonly DashboardMatch[];
  overallSimilarityScore: number | null;
  extractedTopics: readonly DashboardExtractedTopic[];
  sourceDetails: DashboardSourceDetails;
  initialTab?: DashboardTab;
  initialExtractedTopicSource?: ExtractedTopicSource;
}

const DASHBOARD_TABS: ReadonlyArray<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "topics", label: "Topic Analysis" },
  { id: "sources", label: "Source Details" },
];

const EXTRACTED_TOPIC_TABS: ReadonlyArray<{
  id: ExtractedTopicSource;
  label: string;
}> = [
  { id: "VIDEO", label: "Lecture Topics" },
  { id: "PDF", label: "PDF Topics" },
];

const BADGE_STYLES: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "border-zinc-950 bg-zinc-950 text-white",
  PARTIAL: "border-zinc-700 bg-zinc-700 text-white",
  WEAK: "border-zinc-300 bg-zinc-200 text-zinc-950",
  MISSING: "border-zinc-950 bg-white text-zinc-950",
};

const PROGRESS_STYLES: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "bg-zinc-950",
  PARTIAL: "bg-zinc-700",
  WEAK: "bg-zinc-400",
  MISSING: "bg-zinc-600",
};

const CHART_COLORS: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "#18181b",
  PARTIAL: "#52525b",
  WEAK: "#a1a1aa",
  MISSING: "#d4d4d8",
};

function percentage(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function AnalysisDashboard({
  matches,
  overallSimilarityScore,
  extractedTopics,
  sourceDetails,
  initialTab = "overview",
  initialExtractedTopicSource = "VIDEO",
}: AnalysisDashboardProps) {
  const dashboard = deriveAnalysisDashboard(matches, overallSimilarityScore);
  const [selectedTab, setSelectedTab] = useState<DashboardTab>(initialTab);
  const matchSummary = `${dashboard.counts.STRONG} strong • ${dashboard.counts.PARTIAL} partial • ${dashboard.counts.WEAK} weak`;

  return (
    <section
      aria-label="Analysis results"
      className="dashboard-stack flex flex-col gap-5 sm:gap-6 lg:gap-8"
    >
      <section aria-labelledby="key-metrics-heading">
        <h2 className="sr-only" id="key-metrics-heading">
          Key analysis metrics
        </h2>
        <div className="grid border-y border-zinc-200 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Overall Match"
            value={percentage(dashboard.overallSimilarityPercentage)}
          />
          <Metric
            label="Topic Coverage"
            value={percentage(dashboard.coveragePercentage, 0)}
          />
          <Metric
            label="Strong Matches"
            value={`${dashboard.counts.STRONG} / ${dashboard.totalPdfTopics}`}
          />
          <Metric label="Missing Topics" value={dashboard.counts.MISSING} />
        </div>
        <div className="mt-3 flex flex-col gap-1 px-1 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:text-sm">
          <p>{matchSummary}</p>
          <p>
            {dashboard.totalPdfTopics} PDF{" "}
            {pluralize(dashboard.totalPdfTopics, "topic")} analyzed
          </p>
        </div>
      </section>

      <DashboardTabNavigation
        selectedTab={selectedTab}
        onSelect={setSelectedTab}
      />

      {selectedTab === "overview" ? (
        <div
          aria-labelledby="dashboard-tab-overview"
          id="dashboard-panel-overview"
          role="tabpanel"
          tabIndex={0}
        >
          <OverviewTab dashboard={dashboard} matchSummary={matchSummary} />
        </div>
      ) : null}

      {selectedTab === "topics" ? (
        <div
          aria-labelledby="dashboard-tab-topics"
          className="space-y-5 sm:space-y-6 lg:space-y-8"
          id="dashboard-panel-topics"
          role="tabpanel"
          tabIndex={0}
        >
          <TopicCoverage topics={dashboard.topicRows} />
          <ExtractedTopicsSwitcher
            initialSource={initialExtractedTopicSource}
            topics={extractedTopics}
          />
        </div>
      ) : null}

      {selectedTab === "sources" ? (
        <div
          aria-labelledby="dashboard-tab-sources"
          id="dashboard-panel-sources"
          role="tabpanel"
          tabIndex={0}
        >
          <SourceDetailsTab details={sourceDetails} />
        </div>
      ) : null}
    </section>
  );
}

function DashboardTabNavigation({
  selectedTab,
  onSelect,
}: {
  selectedTab: DashboardTab;
  onSelect: (tab: DashboardTab) => void;
}) {
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: DashboardTab,
  ) => {
    const nextTab = getAdjacentTab(
      DASHBOARD_TABS.map((tab) => tab.id),
      currentTab,
      event.key,
    );
    if (!nextTab) return;

    event.preventDefault();
    onSelect(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`dashboard-tab-${nextTab}`)?.focus();
    });
  };

  return (
    <div className="overflow-x-auto border-b border-zinc-200">
      <div
        aria-label="Analysis dashboard sections"
        className="flex min-w-max gap-2"
        role="tablist"
      >
        {DASHBOARD_TABS.map((tab) => {
          const selected = selectedTab === tab.id;
          return (
            <button
              aria-controls={`dashboard-panel-${tab.id}`}
              aria-selected={selected}
              className={`relative min-h-11 px-3 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950 ${
                selected
                  ? "text-zinc-950 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-zinc-950"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
              }`}
              id={`dashboard-tab-${tab.id}`}
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverviewTab({
  dashboard,
  matchSummary,
}: {
  dashboard: AnalysisDashboardData;
  matchSummary: string;
}) {
  const distributionLabel = dashboard.distribution
    .map((item) => `${item.label}: ${item.count}`)
    .join(", ");
  const alignmentSummary = getAlignmentSummary(
    dashboard.totalPdfTopics,
    dashboard.coveredTopics,
    dashboard.counts.MISSING,
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid border-b border-zinc-200 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:divide-x xl:divide-zinc-200">
        <section
          aria-labelledby="alignment-heading"
          className="dashboard-panel py-5 sm:py-6 xl:pr-8"
        >
          <h2
            className="text-base font-semibold text-zinc-950"
            id="alignment-heading"
          >
            Lecture–PDF Alignment
          </h2>
          <p className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-4xl">
            {percentage(dashboard.overallSimilarityPercentage)}
          </p>
          <div
            aria-label={`Overall lecture-to-PDF alignment: ${percentage(dashboard.overallSimilarityPercentage)}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={dashboard.overallSimilarityPercentage}
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-200"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-zinc-950"
              style={{ width: `${dashboard.overallSimilarityPercentage}%` }}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-700">
            {alignmentSummary}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{matchSummary}</p>
        </section>

        <section
          aria-labelledby="match-distribution-heading"
          className="dashboard-panel border-t border-zinc-200 py-5 sm:py-6 xl:border-t-0 xl:pl-8"
        >
          <h2
            className="text-base font-semibold text-zinc-950"
            id="match-distribution-heading"
          >
            Match Distribution
          </h2>
          <p className="mt-2 text-sm text-zinc-600">
            PDF topics by stored match category.
          </p>
          <div
            aria-label={`Match distribution. ${distributionLabel}`}
            className="dashboard-chart mt-4 h-44 w-full sm:h-48 lg:h-52"
            role="img"
          >
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                accessibilityLayer
                data={dashboard.distribution}
                layout="vertical"
                margin={{ top: 4, right: 32, bottom: 4, left: 0 }}
              >
                <XAxis allowDecimals={false} hide type="number" />
                <YAxis
                  axisLine={false}
                  dataKey="label"
                  tick={{ fill: "#52525b", fontSize: 12 }}
                  tickLine={false}
                  type="category"
                  width={58}
                />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e4e4e7",
                    borderRadius: 8,
                    boxShadow: "none",
                    fontSize: 12,
                  }}
                  cursor={{ fill: "#fafafa" }}
                  itemStyle={{ color: "#18181b" }}
                  labelStyle={{ color: "#52525b" }}
                />
                <Bar dataKey="count" name="PDF topics" radius={[0, 6, 6, 0]}>
                  {dashboard.distribution.map((item) => (
                    <Cell
                      fill={CHART_COLORS[item.matchType]}
                      key={item.matchType}
                    />
                  ))}
                  <LabelList
                    dataKey="count"
                    fill="#3f3f46"
                    fontSize={12}
                    fontWeight={600}
                    position="right"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <MissingTopics topics={dashboard.missingTopics} />
    </div>
  );
}

function getAlignmentSummary(total: number, covered: number, missing: number) {
  if (total === 0) return "No PDF topics were available for comparison.";
  if (missing === 0) {
    if (total === 1) return "The PDF topic has a lecture match.";
    return `All ${total} PDF ${pluralize(total, "topic")} have a lecture match.`;
  }

  return `${covered} of ${total} PDF ${pluralize(total, "topic")} have a lecture match. ${missing} ${pluralize(missing, "topic")} ${missing === 1 ? "is" : "are"} missing.`;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div
      className="px-2 py-4 sm:px-4 sm:py-5"
      data-primary-metric
    >
      <p className="text-xs font-medium text-zinc-500 sm:text-sm">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
        {value}
      </p>
    </div>
  );
}

function TopicCoverage({ topics }: { topics: DashboardTopicRow[] }) {
  return (
    <section
      aria-labelledby="topic-coverage-heading"
      className="dashboard-panel border-y border-zinc-200 py-5 sm:py-6"
    >
      <h2
        className="text-xl font-semibold tracking-tight text-zinc-950"
        id="topic-coverage-heading"
      >
        Topic Coverage
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        Stored similarity and match category for each PDF topic, in PDF order.
      </p>
      {topics.length > 0 ? (
        <>
          <div className="mt-6 hidden grid-cols-[minmax(0,1fr)_7rem_5rem] gap-4 border-y border-zinc-200 py-2.5 text-xs font-medium text-zinc-500 sm:grid">
            <span>Topic</span>
            <span>Match</span>
            <span className="text-right">Score</span>
          </div>
          <ul className="divide-y divide-zinc-200 border-b border-zinc-200 sm:border-b-0">
            {topics.map((topic) => (
              <li className="py-3.5" key={topic.pdfTopicId}>
                <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_5rem] sm:items-center sm:gap-4">
                  <p className="min-w-0 font-semibold text-zinc-950">
                    {topic.pdfTopicName}
                  </p>
                  <div className="flex items-center justify-between gap-3 sm:contents">
                    <span
                      className={`w-fit rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BADGE_STYLES[topic.matchType]}`}
                    >
                      {topic.matchType}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-700">
                      {percentage(topic.similarityPercentage)}
                    </span>
                  </div>
                </div>
                <div
                  aria-label={`${topic.pdfTopicName}: ${percentage(topic.similarityPercentage)} ${topic.matchType.toLowerCase()}`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={topic.similarityPercentage}
                  className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-200"
                  role="progressbar"
                >
                  <div
                    className={`h-full rounded-full ${PROGRESS_STYLES[topic.matchType]}`}
                    style={{ width: `${topic.similarityPercentage}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-6 rounded-xl bg-zinc-50 p-5 text-sm text-zinc-600">
          No topic comparison results are available.
        </p>
      )}
    </section>
  );
}

function ExtractedTopicsSwitcher({
  topics,
  initialSource,
}: {
  topics: readonly DashboardExtractedTopic[];
  initialSource: ExtractedTopicSource;
}) {
  const [selectedSource, setSelectedSource] =
    useState<ExtractedTopicSource>(initialSource);
  const visibleTopics = topics.filter(
    (topic) => topic.source === selectedSource,
  );
  const selectedLabel =
    EXTRACTED_TOPIC_TABS.find((tab) => tab.id === selectedSource)?.label ??
    "Extracted Topics";

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentSource: ExtractedTopicSource,
  ) => {
    const nextSource = getAdjacentTab(
      EXTRACTED_TOPIC_TABS.map((tab) => tab.id),
      currentSource,
      event.key,
    );
    if (!nextSource) return;

    event.preventDefault();
    setSelectedSource(nextSource);
    requestAnimationFrame(() => {
      document.getElementById(`extracted-tab-${nextSource}`)?.focus();
    });
  };

  return (
    <section
      aria-labelledby="extracted-topics-heading"
      className="dashboard-panel border-y border-zinc-200 py-5 sm:py-6"
    >
      <h2
        className="text-xl font-semibold tracking-tight text-zinc-950"
        id="extracted-topics-heading"
      >
        Extracted Topics
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        Topics identified from each source with extraction confidence.
      </p>

      <div className="mt-5 overflow-x-auto">
        <div
          aria-label="Extracted topic source"
          className="inline-flex min-w-max border-b border-zinc-200"
          role="tablist"
        >
          {EXTRACTED_TOPIC_TABS.map((tab) => {
            const selected = selectedSource === tab.id;
            return (
              <button
                aria-controls="extracted-topics-panel"
                aria-selected={selected}
                className={`relative min-h-10 px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 ${
                  selected
                    ? "text-zinc-950 after:absolute after:inset-x-2 after:bottom-[-1px] after:h-px after:bg-zinc-950"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
                }`}
                id={`extracted-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setSelectedSource(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tab.id)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        aria-labelledby={`extracted-tab-${selectedSource}`}
        className="mt-6"
        id="extracted-topics-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <h3 className="text-lg font-semibold text-zinc-950">
          {selectedLabel}
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          {visibleTopics.length} extracted{" "}
          {pluralize(visibleTopics.length, "topic")}
        </p>
        {visibleTopics.length > 0 ? (
          <ul className="mt-5 divide-y divide-zinc-200 border-y border-zinc-200">
            {visibleTopics.map((topic, index) => (
              <li
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                key={topic.id ?? `${topic.source}-${topic.name}-${index}`}
              >
                <p className="min-w-0 font-medium text-zinc-900">
                  {topic.name}
                </p>
                {topic.confidence !== null ? (
                  <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-600">
                    Confidence {Math.round(topic.confidence * 100)}%
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 rounded-xl bg-zinc-50 p-5 text-sm text-zinc-600">
            No {selectedLabel.toLowerCase()} were extracted.
          </p>
        )}
      </div>
    </section>
  );
}

function SourceDetailsTab({ details }: { details: DashboardSourceDetails }) {
  return (
    <div>
      <section
        aria-labelledby="source-text-heading"
        className="dashboard-panel border-y border-zinc-200 py-5 sm:py-6"
      >
        <h2
          className="text-xl font-semibold text-zinc-950"
          id="source-text-heading"
        >
          Source Text
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Open either source when you need to inspect the extracted text.
        </p>
        <div className="mt-5 divide-y divide-zinc-200 border-y border-zinc-200">
          <SourceTextDetails
            emptyMessage="No transcript has been generated yet."
            label="Lecture transcript"
            text={details.transcriptText}
          />
          <SourceTextDetails
            emptyMessage="No PDF text has been extracted yet."
            label="Extracted PDF text"
            text={details.pdfText}
          />
        </div>
      </section>
    </div>
  );
}

function SourceTextDetails({
  emptyMessage,
  label,
  text,
}: {
  emptyMessage: string;
  label: string;
  text: string | null;
}) {
  return (
    <details>
      <summary className="cursor-pointer py-4 font-medium text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        {label}
      </summary>
      <div className="pb-5">
        {text ? (
          <p className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-4 text-sm leading-7 text-zinc-700 sm:p-5">
            {text}
          </p>
        ) : (
          <p className="rounded-xl bg-zinc-50 p-5 text-sm leading-6 text-zinc-600">
            {emptyMessage}
          </p>
        )}
      </div>
    </details>
  );
}

function MissingTopics({ topics }: { topics: DashboardTopicRow[] }) {
  if (topics.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900">
        <span aria-hidden="true">✓</span>
        <span>No PDF topics are completely missing from the lecture.</span>
      </p>
    );
  }

  return (
    <section
      aria-labelledby="missing-topics-heading"
      className="rounded-xl border border-zinc-300 bg-zinc-100 px-5 py-4"
    >
      <h2
        className="text-base font-semibold text-zinc-950"
        id="missing-topics-heading"
      >
        Missing Topics
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <li
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950"
            key={topic.pdfTopicId}
          >
            <span className="font-medium">{topic.pdfTopicName}</span>
            <span className="ml-2 tabular-nums text-zinc-600">
              {percentage(topic.similarityPercentage)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function getAdjacentTab<T extends string>(
  tabs: readonly T[],
  current: T,
  key: string,
): T | null {
  const currentIndex = tabs.indexOf(current);
  if (currentIndex < 0) return null;
  if (key === "Home") return tabs[0] ?? null;
  if (key === "End") return tabs.at(-1) ?? null;
  if (key === "ArrowRight") return tabs[(currentIndex + 1) % tabs.length] ?? null;
  if (key === "ArrowLeft") {
    return tabs[(currentIndex - 1 + tabs.length) % tabs.length] ?? null;
  }
  return null;
}
