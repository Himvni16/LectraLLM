"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AnalysisDashboard } from "@/components/analysis-dashboard";
import {
  getAnalysisStatusLabel,
  isTerminalAnalysisStatus,
  shouldPollAnalysis,
} from "@/lib/analysis-pipeline/presentation";
import type { DashboardMatch } from "@/lib/analysis-dashboard";

interface AnalysisTopicView {
  id?: string;
  name: string;
  source: string;
  confidence: number | null;
}

export interface AnalysisView {
  id: string;
  videoFileName: string;
  pdfFileName: string;
  status: string;
  transcriptText: string | null;
  pdfText: string | null;
  overallSimilarityScore: number | null;
  topics: AnalysisTopicView[];
  comparisonMatches: DashboardMatch[];
}

interface TranscriptionPanelProps {
  initialAnalysis: AnalysisView;
}

const GENERIC_FAILURE_MESSAGE =
  "We couldn't complete the analysis. You can retry from where it stopped.";

export function TranscriptionPanel({ initialAnalysis }: TranscriptionPanelProps) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isPipelineRequestActive, setIsPipelineRequestActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutomaticallyStarted = useRef(false);
  const requestInFlight = useRef(false);

  const refreshAnalysis = useCallback(async () => {
    const response = await fetch(
      `/api/analyses/${encodeURIComponent(initialAnalysis.id)}`,
      { cache: "no-store" },
    );

    if (!response.ok) throw new Error("Analysis status unavailable");
    const nextAnalysis = (await response.json()) as AnalysisView;
    setAnalysis(nextAnalysis);
    return nextAnalysis;
  }, [initialAnalysis.id]);

  const startPipeline = useCallback(async () => {
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    setIsPipelineRequestActive(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(initialAnalysis.id)}/run`,
        { method: "POST" },
      );

      if (!response.ok) throw new Error("Analysis pipeline failed");
      await refreshAnalysis();
    } catch {
      setError(GENERIC_FAILURE_MESSAGE);
      try {
        await refreshAnalysis();
      } catch {
        // Keep the safe pipeline message when a follow-up status read also fails.
      }
    } finally {
      requestInFlight.current = false;
      setIsPipelineRequestActive(false);
    }
  }, [initialAnalysis.id, refreshAnalysis]);

  useEffect(() => {
    if (
      !hasAutomaticallyStarted.current &&
      !isTerminalAnalysisStatus(initialAnalysis.status)
    ) {
      hasAutomaticallyStarted.current = true;
      void startPipeline();
    }
  }, [initialAnalysis.status, startPipeline]);

  useEffect(() => {
    if (!shouldPollAnalysis(analysis.status)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const nextAnalysis = await refreshAnalysis();
        if (cancelled || !shouldPollAnalysis(nextAnalysis.status)) return;
      } catch {
        if (cancelled) return;
      }

      timer = setTimeout(poll, 2000);
    };

    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [analysis.status, refreshAnalysis]);

  const failed = analysis.status === "FAILED";
  const completed = analysis.status === "COMPLETED";

  if (completed) {
    return (
      <div className="mt-8 space-y-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
            Completed analysis
          </p>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                Lecture Analysis
              </h1>
              <p className="mt-4 break-words text-base font-medium leading-7 text-slate-700 sm:text-lg">
                {analysis.videoFileName}
                <span className="mx-2 font-normal text-slate-400">vs</span>
                {analysis.pdfFileName}
              </p>
            </div>
            <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">
              <span aria-hidden="true" className="size-2 rounded-full bg-emerald-600" />
              Analysis complete
            </span>
          </div>
        </header>

        <AnalysisDashboard
          extractedTopics={analysis.topics}
          matches={analysis.comparisonMatches}
          overallSimilarityScore={analysis.overallSimilarityScore}
          sourceDetails={{
            transcriptText: analysis.transcriptText,
            pdfText: analysis.pdfText,
          }}
        />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          Analysis
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Lecture analysis
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          LectraLLM processes the lecture and PDF automatically, then shows the
          completed coverage dashboard here.
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="space-y-5 text-sm">
          <AnalysisDetail label="Video" value={analysis.videoFileName} />
          <AnalysisDetail label="PDF" value={analysis.pdfFileName} />
          <AnalysisDetail
            label="Status"
            value={getAnalysisStatusLabel(analysis.status)}
          />
          <AnalysisDetail label="Analysis ID" value={analysis.id} />
        </dl>

        <div className="mt-7 border-t border-slate-200 pt-6">
          <h2 className="text-lg font-semibold text-slate-950">
            {failed ? "Analysis paused" : "Analyzing your lecture"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {failed
              ? GENERIC_FAILURE_MESSAGE
              : getAnalysisStatusLabel(analysis.status)}
          </p>
          <ProgressSteps analysis={analysis} />

          {failed ? (
            <button
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:bg-slate-400"
              disabled={isPipelineRequestActive}
              onClick={() => void startPipeline()}
              type="button"
            >
              {isPipelineRequestActive ? "Retrying analysis…" : "Retry Analysis"}
            </button>
          ) : null}
        </div>

        {error && !failed ? (
          <p
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </aside>

      <div className="space-y-8">
        <section className="rounded-2xl border border-blue-100 bg-blue-50 p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
            In progress
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            {getAnalysisStatusLabel(analysis.status)}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            You can leave this page open while LectraLLM works through the
            remaining steps.
          </p>
        </section>

          <div className="grid gap-8 xl:grid-cols-2">
          <TopicPanel
            emptyMessage="Lecture topics will appear after extraction."
            label="Lecture topics"
            topics={analysis.topics.filter((topic) => topic.source === "VIDEO")}
          />
          <TopicPanel
            emptyMessage="PDF topics will appear after extraction."
            label="PDF topics and subtopics"
            topics={analysis.topics.filter((topic) => topic.source === "PDF")}
          />
        </div>
        </div>
      </div>
    </div>
  );
}

function ProgressSteps({ analysis }: { analysis: AnalysisView }) {
  const hasVideoTopics = analysis.topics.some(
    (topic) => topic.source === "VIDEO",
  );
  const hasPdfTopics = analysis.topics.some((topic) => topic.source === "PDF");
  const completedSteps = [
    true,
    Boolean(analysis.transcriptText?.trim()),
    Boolean(analysis.pdfText?.trim()),
    hasVideoTopics && hasPdfTopics,
    analysis.status === "COMPLETED",
  ];
  const labels = [
    "Upload complete",
    "Transcribing lecture",
    "Reading PDF",
    "Extracting topics",
    "Comparing content",
  ];
  const statusStep: Readonly<Record<string, number>> = {
    UPLOADED: 1,
    TRANSCRIBING: 1,
    EXTRACTING_PDF: 2,
    EXTRACTING_TOPICS: 3,
    COMPARING: 4,
  };
  const activeStep =
    analysis.status === "FAILED"
      ? completedSteps.findIndex((step) => !step)
      : (statusStep[analysis.status] ?? -1);

  return (
    <ol className="mt-5 space-y-3" aria-label="Analysis progress">
      {labels.map((label, index) => {
        const isComplete = completedSteps[index];
        const isActive = index === activeStep;
        return (
          <li className="flex items-center gap-3 text-sm" key={label}>
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${
                isComplete
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : isActive
                    ? analysis.status === "FAILED"
                      ? "border-red-500 bg-red-50 text-red-700"
                      : "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 bg-white text-slate-400"
              }`}
              aria-hidden="true"
            >
              {isComplete ? "✓" : isActive ? "●" : "○"}
            </span>
            <span
              className={
                isComplete || isActive
                  ? "font-medium text-slate-900"
                  : "text-slate-500"
              }
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TopicPanel({
  emptyMessage,
  label,
  topics,
}: {
  emptyMessage: string;
  label: string;
  topics: AnalysisTopicView[];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
        {label}
      </p>
      {topics.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {topics.map((topic, index) => (
            <li
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
              key={topic.id ?? `${topic.source}-${topic.name}-${index}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-slate-900">{topic.name}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {topic.source}
                  </p>
                </div>
                {topic.confidence !== null ? (
                  <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                    {Math.round(topic.confidence * 100)}%
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function AnalysisDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
