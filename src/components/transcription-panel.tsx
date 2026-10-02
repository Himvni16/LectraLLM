"use client";

import { useState } from "react";

import { AnalysisDashboard } from "@/components/analysis-dashboard";
import type { DashboardMatch } from "@/lib/analysis-dashboard";
import type { PdfExtractionSuccessResponse } from "@/lib/pdf-extraction/types";
import type { TopicComparisonSuccessResponse } from "@/lib/topic-comparison/types";
import type { TopicExtractionSuccessResponse } from "@/lib/topic-extraction/types";
import type { TranscriptionSuccessResponse } from "@/lib/transcription/types";

interface AnalysisTopicView {
  id?: string;
  name: string;
  source: string;
  confidence: number | null;
}

interface AnalysisView {
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

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  UPLOADED: "Uploaded",
  TRANSCRIBING: "Transcribing",
  EXTRACTING_PDF: "Ready for PDF extraction",
  EXTRACTING_TOPICS: "Ready for topic extraction",
  COMPARING: "Ready for comparison",
  COMPLETED: "Completed",
  FAILED: "Processing failed",
};

export function TranscriptionPanel({ initialAnalysis }: TranscriptionPanelProps) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [isExtractingTopics, setIsExtractingTopics] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canTranscribe =
    analysis.status === "UPLOADED" ||
    (analysis.status === "FAILED" && !analysis.transcriptText);
  const canExtractPdf =
    analysis.status === "EXTRACTING_PDF" ||
    (analysis.status === "FAILED" &&
      Boolean(analysis.transcriptText) &&
      !analysis.pdfText);
  const canExtractTopics =
    analysis.status === "EXTRACTING_TOPICS" ||
    (analysis.status === "FAILED" &&
      Boolean(analysis.transcriptText) &&
      Boolean(analysis.pdfText) &&
      analysis.topics.length === 0);
  const hasVideoTopics = analysis.topics.some(
    (topic) => topic.source === "VIDEO",
  );
  const hasPdfTopics = analysis.topics.some((topic) => topic.source === "PDF");
  const canCompare =
    analysis.status === "COMPARING" ||
    (analysis.status === "FAILED" && hasVideoTopics && hasPdfTopics);

  async function handleTranscription() {
    const previousStatus = analysis.status;
    setError(null);
    setIsTranscribing(true);
    setAnalysis((current) => ({ ...current, status: "TRANSCRIBING" }));

    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysis.id)}/transcribe`,
        { method: "POST" },
      );
      const payload = (await response.json()) as
        | TranscriptionSuccessResponse
        | ErrorResponse;

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error?.message : undefined;
        const failure = new Error(
          message ?? "The lecture could not be transcribed.",
        );
        failure.name =
          "error" in payload
            ? (payload.error?.code ?? "TRANSCRIPTION_FAILED")
            : "TRANSCRIPTION_FAILED";
        throw failure;
      }

      const result = payload as TranscriptionSuccessResponse;
      setAnalysis((current) => ({
        ...current,
        status: result.status,
        transcriptText: result.text,
      }));
    } catch (transcriptionError) {
      const nextStatus =
        transcriptionError instanceof Error &&
        transcriptionError.name === "TRANSCRIPTION_NOT_ALLOWED"
          ? previousStatus
          : "FAILED";
      setAnalysis((current) => ({ ...current, status: nextStatus }));
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "The lecture could not be transcribed.",
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  async function handlePdfExtraction() {
    const previousStatus = analysis.status;
    setError(null);
    setIsExtractingPdf(true);
    setAnalysis((current) => ({ ...current, status: "EXTRACTING_PDF" }));

    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysis.id)}/extract-pdf`,
        { method: "POST" },
      );
      const payload = (await response.json()) as
        | PdfExtractionSuccessResponse
        | ErrorResponse;

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error?.message : undefined;
        const failure = new Error(
          message ?? "The PDF text could not be extracted.",
        );
        failure.name =
          "error" in payload
            ? (payload.error?.code ?? "PDF_EXTRACTION_FAILED")
            : "PDF_EXTRACTION_FAILED";
        throw failure;
      }

      const result = payload as PdfExtractionSuccessResponse;
      setAnalysis((current) => ({
        ...current,
        status: result.status,
        pdfText: result.text,
        topics: [],
        overallSimilarityScore: null,
        comparisonMatches: [],
      }));
    } catch (extractionError) {
      const nextStatus =
        extractionError instanceof Error &&
        extractionError.name === "PDF_EXTRACTION_NOT_ALLOWED"
          ? previousStatus
          : "FAILED";
      setAnalysis((current) => ({ ...current, status: nextStatus }));
      setError(
        extractionError instanceof Error
          ? extractionError.message
          : "The PDF text could not be extracted.",
      );
    } finally {
      setIsExtractingPdf(false);
    }
  }

  async function handleTopicExtraction() {
    const previousStatus = analysis.status;
    setError(null);
    setIsExtractingTopics(true);
    setAnalysis((current) => ({ ...current, status: "EXTRACTING_TOPICS" }));

    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysis.id)}/extract-topics`,
        { method: "POST" },
      );
      const payload = (await response.json()) as
        | TopicExtractionSuccessResponse
        | ErrorResponse;

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error?.message : undefined;
        const failure = new Error(message ?? "Topics could not be extracted.");
        failure.name =
          "error" in payload
            ? (payload.error?.code ?? "TOPIC_EXTRACTION_FAILED")
            : "TOPIC_EXTRACTION_FAILED";
        throw failure;
      }

      const result = payload as TopicExtractionSuccessResponse;
      setAnalysis((current) => ({
        ...current,
        status: result.status,
        topics: [
          ...result.videoTopics.map((topic) => ({
            ...topic,
            source: "VIDEO",
          })),
          ...result.pdfTopics.map((topic) => ({
            ...topic,
            source: "PDF",
          })),
        ],
        overallSimilarityScore: null,
        comparisonMatches: [],
      }));
    } catch (extractionError) {
      const nextStatus =
        extractionError instanceof Error &&
        extractionError.name === "TOPIC_EXTRACTION_NOT_ALLOWED"
          ? previousStatus
          : "FAILED";
      setAnalysis((current) => ({ ...current, status: nextStatus }));
      setError(
        extractionError instanceof Error
          ? extractionError.message
          : "Topics could not be extracted.",
      );
    } finally {
      setIsExtractingTopics(false);
    }
  }

  async function handleComparison() {
    const previousStatus = analysis.status;
    setError(null);
    setIsComparing(true);
    setAnalysis((current) => ({ ...current, status: "COMPARING" }));

    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysis.id)}/compare`,
        { method: "POST" },
      );
      const payload = (await response.json()) as
        | TopicComparisonSuccessResponse
        | ErrorResponse;

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error?.message : undefined;
        const failure = new Error(message ?? "Topics could not be compared.");
        failure.name =
          "error" in payload
            ? (payload.error?.code ?? "COMPARISON_FAILED")
            : "COMPARISON_FAILED";
        throw failure;
      }

      const result = payload as TopicComparisonSuccessResponse;
      setAnalysis((current) => ({
        ...current,
        status: result.status,
        overallSimilarityScore: result.overallSimilarityScore,
        comparisonMatches: result.matches,
      }));
    } catch (comparisonError) {
      const nextStatus =
        comparisonError instanceof Error &&
        comparisonError.name === "COMPARISON_NOT_ALLOWED"
          ? previousStatus
          : "FAILED";
      setAnalysis((current) => ({ ...current, status: nextStatus }));
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "Topics could not be compared.",
      );
    } finally {
      setIsComparing(false);
    }
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="space-y-5 text-sm">
          <AnalysisDetail label="Video" value={analysis.videoFileName} />
          <AnalysisDetail label="PDF" value={analysis.pdfFileName} />
          <AnalysisDetail
            label="Status"
            value={STATUS_LABELS[analysis.status] ?? analysis.status}
          />
          <AnalysisDetail label="Analysis ID" value={analysis.id} />
        </dl>

        {canTranscribe ? (
          <button
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:bg-slate-400"
            disabled={isTranscribing}
            onClick={handleTranscription}
            type="button"
          >
            {isTranscribing
              ? "Transcribing lecture…"
              : analysis.status === "FAILED"
                ? "Retry transcription"
                : "Transcribe lecture"}
          </button>
        ) : null}

        {canExtractPdf ? (
          <button
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:bg-slate-400"
            disabled={isExtractingPdf}
            onClick={handlePdfExtraction}
            type="button"
          >
            {isExtractingPdf
              ? "Extracting PDF text…"
              : analysis.status === "FAILED"
                ? "Retry PDF extraction"
                : "Extract PDF text"}
          </button>
        ) : null}

        {canExtractTopics ? (
          <button
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-wait disabled:bg-slate-400"
            disabled={isExtractingTopics}
            onClick={handleTopicExtraction}
            type="button"
          >
            {isExtractingTopics
              ? "Extracting topics…"
              : analysis.status === "FAILED"
                ? "Retry topic extraction"
                : "Extract topics"}
          </button>
        ) : null}

        {canCompare ? (
          <button
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:bg-slate-400"
            disabled={isComparing}
            onClick={handleComparison}
            type="button"
          >
            {isComparing
              ? "Comparing topics…"
              : analysis.status === "FAILED"
                ? "Retry topic comparison"
                : "Compare Lecture & PDF"}
          </button>
        ) : null}

        {error ? (
          <p
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </aside>

      <div className="space-y-8">
        {analysis.status === "COMPLETED" ? (
          <AnalysisDashboard
            matches={analysis.comparisonMatches}
            overallSimilarityScore={analysis.overallSimilarityScore}
          />
        ) : (
          <>
            <TextPanel
              emptyMessage={
                isTranscribing
                  ? "The local AI service is transcribing this lecture. Longer videos can take several minutes on CPU."
                  : "No transcript has been generated yet."
              }
              label="Lecture transcript"
              text={analysis.transcriptText}
            />
            <TextPanel
              emptyMessage={
                isExtractingPdf
                  ? "The local AI service is extracting readable text from the PDF."
                  : "No PDF text has been extracted yet."
              }
              label="Extracted PDF text"
              text={analysis.pdfText}
            />
          </>
        )}
        <div className="grid gap-8 xl:grid-cols-2">
          <TopicPanel
            emptyMessage={
              isExtractingTopics
                ? "Lecture topics are being extracted."
                : "No lecture topics have been extracted yet."
            }
            label="Lecture topics"
            topics={analysis.topics.filter((topic) => topic.source === "VIDEO")}
          />
          <TopicPanel
            emptyMessage={
              isExtractingTopics
                ? "PDF topics and subtopics are being extracted."
                : "No PDF topics have been extracted yet."
            }
            label="PDF topics and subtopics"
            topics={analysis.topics.filter((topic) => topic.source === "PDF")}
          />
        </div>
        {analysis.status === "COMPLETED" ? (
          <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <summary className="cursor-pointer text-lg font-semibold text-slate-950">
              Source text
            </summary>
            <div className="mt-6 space-y-8">
              <TextPanel
                emptyMessage="No transcript has been generated yet."
                label="Lecture transcript"
                text={analysis.transcriptText}
              />
              <TextPanel
                emptyMessage="No PDF text has been extracted yet."
                label="Extracted PDF text"
                text={analysis.pdfText}
              />
            </div>
          </details>
        ) : null}
      </div>
    </div>
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

function TextPanel({
  emptyMessage,
  label,
  text,
}: {
  emptyMessage: string;
  label: string;
  text: string | null;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
        {label}
      </p>
      {text ? (
        <p className="mt-5 whitespace-pre-wrap text-base leading-8 text-slate-700">
          {text}
        </p>
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
