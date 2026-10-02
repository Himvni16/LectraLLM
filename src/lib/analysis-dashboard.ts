export const DASHBOARD_MATCH_TYPES = [
  "STRONG",
  "PARTIAL",
  "WEAK",
  "MISSING",
] as const;

export type DashboardMatchType = (typeof DASHBOARD_MATCH_TYPES)[number];

export interface DashboardMatch {
  id?: string;
  pdfTopicId: string;
  pdfTopicName: string;
  videoTopicId: string | null;
  videoTopicName: string | null;
  similarityScore: number;
  matchType: DashboardMatchType;
}

export interface DashboardTopicRow extends DashboardMatch {
  similarityPercentage: number;
}

export interface DashboardDistributionRow {
  matchType: DashboardMatchType;
  label: string;
  count: number;
  color: string;
}

export interface AnalysisDashboardData {
  overallSimilarityPercentage: number;
  coveragePercentage: number;
  totalPdfTopics: number;
  coveredTopics: number;
  counts: Record<DashboardMatchType, number>;
  distribution: DashboardDistributionRow[];
  topicRows: DashboardTopicRow[];
  missingTopics: DashboardTopicRow[];
}

const MATCH_TYPE_PRESENTATION: Readonly<
  Record<DashboardMatchType, { label: string; color: string }>
> = {
  STRONG: { label: "Strong", color: "#047857" },
  PARTIAL: { label: "Partial", color: "#2563eb" },
  WEAK: { label: "Weak", color: "#d97706" },
  MISSING: { label: "Missing", color: "#dc2626" },
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function deriveAnalysisDashboard(
  matches: readonly DashboardMatch[],
  overallSimilarityScore: number | null,
): AnalysisDashboardData {
  const counts: Record<DashboardMatchType, number> = {
    STRONG: 0,
    PARTIAL: 0,
    WEAK: 0,
    MISSING: 0,
  };

  const topicRows = matches.map((match) => {
    counts[match.matchType] += 1;
    return {
      ...match,
      similarityPercentage: clampPercentage(match.similarityScore * 100),
    };
  });

  const totalPdfTopics = topicRows.length;
  const coveredTopics = totalPdfTopics - counts.MISSING;
  const coveragePercentage =
    totalPdfTopics === 0 ? 0 : (coveredTopics / totalPdfTopics) * 100;

  return {
    overallSimilarityPercentage: clampPercentage(overallSimilarityScore ?? 0),
    coveragePercentage,
    totalPdfTopics,
    coveredTopics,
    counts,
    distribution: DASHBOARD_MATCH_TYPES.map((matchType) => ({
      matchType,
      label: MATCH_TYPE_PRESENTATION[matchType].label,
      count: counts[matchType],
      color: MATCH_TYPE_PRESENTATION[matchType].color,
    })),
    topicRows,
    missingTopics: topicRows.filter(
      (topic) => topic.matchType === "MISSING",
    ),
  };
}
