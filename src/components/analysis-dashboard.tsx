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
import {
  EmptyState,
  MetricCard,
  ProgressBar,
  StatusBadge,
  TabButton,
  TabsList,
  type StatusTone,
} from "@/components/ui";

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
  initialExpandedExtractedTopicSources?: readonly ExtractedTopicSource[];
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

const BADGE_TONES: Readonly<Record<DashboardMatchType, StatusTone>> = {
  STRONG: "dark",
  PARTIAL: "mid",
  WEAK: "soft",
  MISSING: "outline",
};

const CHART_COLORS: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "var(--gray-ink)",
  PARTIAL: "var(--gray-body)",
  WEAK: "var(--gray-muted)",
  MISSING: "var(--gray-line-strong)",
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
  initialExpandedExtractedTopicSources = [],
}: AnalysisDashboardProps) {
  const dashboard = deriveAnalysisDashboard(matches, overallSimilarityScore);
  const [selectedTab, setSelectedTab] = useState<DashboardTab>(initialTab);

  return (
    <section
      aria-label="Analysis results"
      className="dashboard-stack flex flex-col gap-6 lg:gap-8"
    >
      <section aria-labelledby="key-metrics-heading">
        <h2 className="sr-only" id="key-metrics-heading">
          Key analysis metrics
        </h2>
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          data-primary-metrics
        >
          <MetricCard
            label="Overall Match"
            value={percentage(dashboard.overallSimilarityPercentage)}
          />
          <MetricCard
            label="Topic Coverage"
            value={percentage(dashboard.coveragePercentage, 0)}
          />
          <MetricCard
            label="Strong Matches"
            value={`${dashboard.counts.STRONG} / ${dashboard.totalPdfTopics}`}
          />
          <MetricCard label="Missing Topics" value={dashboard.counts.MISSING} />
        </div>
      </section>

      <div
        className="flex flex-col gap-2 sm:gap-3"
        data-dashboard-tabs
      >
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
            <OverviewTab dashboard={dashboard} />
          </div>
        ) : null}

        {selectedTab === "topics" ? (
          <div
            aria-labelledby="dashboard-tab-topics"
            className="grid border-b border-zinc-200 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-start lg:divide-x lg:divide-zinc-200"
            id="dashboard-panel-topics"
            role="tabpanel"
            tabIndex={0}
          >
            <TopicCoverage topics={dashboard.topicRows} />
            <ExtractedTopicsSwitcher
              initialExpandedSources={initialExpandedExtractedTopicSources}
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
      </div>
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
    <TabsList ariaLabel="Analysis dashboard sections">
      {DASHBOARD_TABS.map((tab) => {
        const selected = selectedTab === tab.id;
        return (
          <TabButton
            aria-controls={`dashboard-panel-${tab.id}`}
            aria-selected={selected}
            id={`dashboard-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, tab.id)}
            role="tab"
            selected={selected}
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {tab.label}
          </TabButton>
        );
      })}
    </TabsList>
  );
}

function OverviewTab({ dashboard }: { dashboard: AnalysisDashboardData }) {
  const distributionLabel = dashboard.distribution
    .map((item) => `${item.label}: ${item.count}`)
    .join(", ");
  const alignmentSummary = getAlignmentSummary(
    dashboard.totalPdfTopics,
    dashboard.coveredTopics,
  );

  return (
    <div>
      <div className="grid border-b border-zinc-200 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:divide-x xl:divide-zinc-200">
        <section
          aria-labelledby="alignment-heading"
          className="dashboard-panel !pt-1 pb-6 xl:pr-8"
        >
          <h2
            className="text-center text-xl font-medium tracking-tight text-zinc-950"
            id="alignment-heading"
          >
            Lecture–PDF Alignment
          </h2>
          <div className="mt-6 flex min-w-0 items-center gap-3">
            <ProgressBar
              className="!h-2.5 min-w-0 flex-1"
              label={`Overall lecture-to-PDF alignment: ${percentage(dashboard.overallSimilarityPercentage)}`}
              value={dashboard.overallSimilarityPercentage}
            />
            <span
              className="shrink-0 text-sm font-semibold tabular-nums text-zinc-800"
              data-alignment-score
            >
              {percentage(dashboard.overallSimilarityPercentage)}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-700">
            {alignmentSummary}
          </p>
          <AlignmentMissingTopics topics={dashboard.missingTopics} />
        </section>

        <section
          aria-labelledby="match-distribution-heading"
          className="dashboard-panel border-t border-zinc-200 py-6 xl:border-t-0 xl:!pt-1 xl:pl-8"
        >
          <h2
            className="text-center text-xl font-medium tracking-tight text-zinc-950"
            id="match-distribution-heading"
          >
            Match Distribution
          </h2>
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
                  tick={{ fill: "var(--gray-body)", fontSize: 12 }}
                  tickLine={false}
                  type="category"
                  width={58}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--gray-canvas)",
                    border: "1px solid var(--gray-line)",
                    borderRadius: 8,
                    boxShadow: "none",
                    fontSize: 12,
                  }}
                  cursor={{ fill: "var(--gray-canvas)" }}
                  itemStyle={{ color: "var(--gray-ink)" }}
                  labelStyle={{ color: "var(--gray-body)" }}
                />
                <Bar dataKey="count" name="PDF topics" radius={[0, 8, 8, 0]}>
                  {dashboard.distribution.map((item) => (
                    <Cell
                      fill={CHART_COLORS[item.matchType]}
                      key={item.matchType}
                    />
                  ))}
                  <LabelList
                    dataKey="count"
                    fill="var(--gray-body)"
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
    </div>
  );
}

function getAlignmentSummary(total: number, covered: number) {
  if (total === 0) return "No PDF topics were available for comparison.";
  return `${covered} of ${total} PDF ${pluralize(total, "topic")} ${total === 1 ? "is" : "are"} covered.`;
}

function TopicCoverage({ topics }: { topics: DashboardTopicRow[] }) {
  return (
    <section
      aria-labelledby="topic-coverage-heading"
      className="dashboard-panel !pt-1 pb-6 lg:pr-8"
    >
      <h2
        className="text-center text-xl font-medium tracking-tight text-zinc-950"
        id="topic-coverage-heading"
      >
        Topic Coverage
      </h2>
      {topics.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-100">
          {topics.map((topic) => (
            <li className="py-3" key={topic.pdfTopicId}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
                <p className="min-w-0 break-words font-medium text-zinc-800">
                  {topic.pdfTopicName}
                </p>
                <div className="flex items-center justify-between gap-3 sm:contents">
                  <StatusBadge
                    dot={false}
                    size="small"
                    tone={BADGE_TONES[topic.matchType]}
                  >
                    {topic.matchType}
                  </StatusBadge>
                  <span className="min-w-14 text-right text-sm font-medium tabular-nums text-zinc-600">
                    {percentage(topic.similarityPercentage)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-6">
          No topic comparison results are available.
        </EmptyState>
      )}
    </section>
  );
}

function ExtractedTopicsSwitcher({
  topics,
  initialSource,
  initialExpandedSources,
}: {
  topics: readonly DashboardExtractedTopic[];
  initialSource: ExtractedTopicSource;
  initialExpandedSources: readonly ExtractedTopicSource[];
}) {
  const [selectedSource, setSelectedSource] =
    useState<ExtractedTopicSource>(initialSource);
  const [expandedSources, setExpandedSources] = useState<
    Record<ExtractedTopicSource, boolean>
  >({
    VIDEO: initialExpandedSources.includes("VIDEO"),
    PDF: initialExpandedSources.includes("PDF"),
  });
  const sourceTopics = topics.filter(
    (topic) => topic.source === selectedSource,
  );
  const isExpanded = expandedSources[selectedSource];
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
      className="dashboard-panel border-t border-zinc-200 py-6 lg:border-t-0 lg:!pt-1 lg:pl-8"
    >
      <h2
        className="text-center text-lg font-medium tracking-tight text-zinc-700"
        id="extracted-topics-heading"
      >
        Extracted Topics
      </h2>

      <TabsList
        ariaLabel="Extracted topic source"
        className="mt-2 w-fit max-w-full [&_[role=tablist]]:gap-1"
      >
        {EXTRACTED_TOPIC_TABS.map((tab) => {
          const selected = selectedSource === tab.id;
          return (
            <TabButton
              aria-controls="extracted-topics-panel"
              aria-selected={selected}
              className="!h-8 !px-2 !text-xs"
              id={`extracted-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setSelectedSource(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              role="tab"
              selected={selected}
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </TabButton>
          );
        })}
      </TabsList>

      <div
        aria-labelledby={`extracted-tab-${selectedSource}`}
        className="mt-3"
        id="extracted-topics-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center justify-between gap-4">
          <p className="min-w-0 text-xs text-zinc-500">
            {sourceTopics.length} {pluralize(sourceTopics.length, "topic")}
          </p>
          {sourceTopics.length > 5 ? (
            <button
              aria-controls={`extracted-topic-list-${selectedSource}`}
              aria-expanded={isExpanded}
              className="shrink-0 rounded px-1 py-1 text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 lg:hidden"
              onClick={() =>
                setExpandedSources((current) => ({
                  ...current,
                  [selectedSource]: !current[selectedSource],
                }))
              }
              type="button"
            >
              {isExpanded ? "Show fewer" : "View all"}
            </button>
          ) : null}
        </div>
        {sourceTopics.length > 0 ? (
          <ul
            className="mt-3 space-y-3"
            id={`extracted-topic-list-${selectedSource}`}
          >
            {sourceTopics.map((topic, index) => (
              <li
                className={`${!isExpanded && index >= 5 ? "hidden lg:block" : "block"} min-w-0 text-sm`}
                key={topic.id ?? `${topic.source}-${topic.name}-${index}`}
              >
                <p className="min-w-0 break-words leading-6 text-zinc-600">
                  {topic.name}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="mt-3">
            No {selectedLabel.toLowerCase()} were extracted.
          </EmptyState>
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
        className="dashboard-panel !pt-1 pb-6"
      >
        <h2
          className="text-xl font-medium tracking-tight text-zinc-950"
          id="source-text-heading"
        >
          Source Text
        </h2>
        <div className="mt-6">
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
      <div className="pb-6">
        {text ? (
          <p className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-4 text-sm leading-7 text-zinc-700">
            {text}
          </p>
        ) : (
          <EmptyState>{emptyMessage}</EmptyState>
        )}
      </div>
    </details>
  );
}

function AlignmentMissingTopics({ topics }: { topics: DashboardTopicRow[] }) {
  if (topics.length === 0) {
    return (
      <p className="mt-4 flex items-center gap-2 border-t border-zinc-200 pt-4 text-sm font-medium text-zinc-800">
        <span aria-hidden="true">✓</span>
        <span>No missing PDF topics</span>
      </p>
    );
  }

  return (
    <div
      className="mt-4 border-t border-zinc-200 pt-4"
      data-alignment-missing-topics
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {topics.length === 1 ? "Missing" : `Missing topics · ${topics.length}`}
      </p>
      <ul className="mt-2 divide-y divide-zinc-200">
        {topics.map((topic) => (
          <li
            className="flex min-w-0 flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            key={topic.pdfTopicId}
          >
            <span className="min-w-0 break-words font-medium text-zinc-900">
              {topic.pdfTopicName}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-600">
              {percentage(topic.similarityPercentage)}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
