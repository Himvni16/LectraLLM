"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  deriveAnalysisDashboard,
  type DashboardMatch,
  type DashboardMatchType,
  type DashboardTopicRow,
} from "@/lib/analysis-dashboard";

interface AnalysisDashboardProps {
  matches: readonly DashboardMatch[];
  overallSimilarityScore: number | null;
}

const BADGE_STYLES: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "bg-emerald-100 text-emerald-800",
  PARTIAL: "bg-blue-100 text-blue-800",
  WEAK: "bg-amber-100 text-amber-800",
  MISSING: "bg-red-100 text-red-800",
};

const PROGRESS_STYLES: Readonly<Record<DashboardMatchType, string>> = {
  STRONG: "bg-emerald-600",
  PARTIAL: "bg-blue-600",
  WEAK: "bg-amber-500",
  MISSING: "bg-red-600",
};

function percentage(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

export function AnalysisDashboard({
  matches,
  overallSimilarityScore,
}: AnalysisDashboardProps) {
  const dashboard = deriveAnalysisDashboard(matches, overallSimilarityScore);
  const distributionLabel = dashboard.distribution
    .map((item) => `${item.label}: ${item.count}`)
    .join(", ");

  return (
    <section aria-labelledby="analysis-dashboard-heading" className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          Completed analysis
        </p>
        <h2
          className="mt-2 text-3xl font-semibold tracking-tight text-slate-950"
          id="analysis-dashboard-heading"
        >
          Analysis dashboard
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          Coverage is measured from the stored best lecture match for every PDF
          topic. No new analysis is performed on this page.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Overall similarity"
          value={percentage(dashboard.overallSimilarityPercentage, 2)}
        />
        <Metric
          label="Coverage"
          value={percentage(dashboard.coveragePercentage, 2)}
        />
        <Metric label="Total PDF topics" value={dashboard.totalPdfTopics} />
        <Metric label="Strong matches" value={dashboard.counts.STRONG} />
        <Metric label="Partial matches" value={dashboard.counts.PARTIAL} />
        <Metric label="Weak matches" value={dashboard.counts.WEAK} />
        <Metric label="Missing topics" value={dashboard.counts.MISSING} />
      </div>

      <section
        aria-labelledby="match-distribution-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h3
          className="text-xl font-semibold text-slate-950"
          id="match-distribution-heading"
        >
          Match distribution
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Number of PDF topics in each stored match category.
        </p>
        <div
          aria-label={`Match distribution. ${distributionLabel}`}
          className="mt-6 h-72 w-full"
          role="img"
        >
          <ResponsiveContainer height="100%" width="100%">
            <BarChart
              accessibilityLayer
              data={dashboard.distribution}
              margin={{ top: 8, right: 8, bottom: 8, left: -18 }}
            >
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#475569", fontSize: 12 }}
              />
              <Tooltip cursor={{ fill: "#f8fafc" }} />
              <Bar dataKey="count" name="PDF topics" radius={[6, 6, 0, 0]}>
                {dashboard.distribution.map((item) => (
                  <Cell fill={item.color} key={item.matchType} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section
        aria-labelledby="topic-coverage-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h3
          className="text-xl font-semibold text-slate-950"
          id="topic-coverage-heading"
        >
          Topic-level coverage
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Stored similarity for every PDF topic, in PDF topic order.
        </p>
        {dashboard.topicRows.length > 0 ? (
          <ul className="mt-6 space-y-5">
            {dashboard.topicRows.map((topic) => (
              <li key={topic.pdfTopicId}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium text-slate-900">
                    {topic.pdfTopicName}
                  </span>
                  <span className="shrink-0 font-semibold text-slate-700">
                    {percentage(topic.similarityPercentage)} · {topic.matchType}
                  </span>
                </div>
                <div
                  aria-label={`${topic.pdfTopicName}: ${percentage(topic.similarityPercentage)} ${topic.matchType.toLowerCase()}`}
                  className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"
                  role="progressbar"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={topic.similarityPercentage}
                >
                  <div
                    className={`h-full rounded-full ${PROGRESS_STYLES[topic.matchType]}`}
                    style={{ width: `${topic.similarityPercentage}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
            No topic comparison results are available.
          </p>
        )}
      </section>

      <MissingTopics topics={dashboard.missingTopics} />
      <DetailedComparisons topics={dashboard.topicRows} />
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function MissingTopics({ topics }: { topics: DashboardTopicRow[] }) {
  return (
    <section
      aria-labelledby="missing-topics-heading"
      className="rounded-2xl border border-red-200 bg-red-50 p-6 sm:p-8"
    >
      <h3
        className="text-xl font-semibold text-red-950"
        id="missing-topics-heading"
      >
        Missing Topics
      </h3>
      {topics.length > 0 ? (
        <ul className="mt-5 divide-y divide-red-200">
          {topics.map((topic) => (
            <li
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              key={topic.pdfTopicId}
            >
              <span className="font-medium text-red-950">
                {topic.pdfTopicName}
              </span>
              <span className="shrink-0 text-sm font-semibold text-red-800">
                {percentage(topic.similarityPercentage)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-red-900">
          All PDF topics have a lecture match.
        </p>
      )}
    </section>
  );
}

function DetailedComparisons({ topics }: { topics: DashboardTopicRow[] }) {
  return (
    <section
      aria-labelledby="detailed-comparison-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h3
        className="text-xl font-semibold text-slate-950"
        id="detailed-comparison-heading"
      >
        Detailed topic comparison
      </h3>
      {topics.length > 0 ? (
        <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
          {topics.map((topic) => (
            <li className="py-5" key={topic.pdfTopicId}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">
                    {topic.pdfTopicName}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {topic.videoTopicName
                      ? `Best lecture match: ${topic.videoTopicName}`
                      : "No lecture match"}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-sm font-medium text-slate-700">
                    {percentage(topic.similarityPercentage)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_STYLES[topic.matchType]}`}
                  >
                    {topic.matchType}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-slate-600">
          No detailed comparison results are available.
        </p>
      )}
    </section>
  );
}
