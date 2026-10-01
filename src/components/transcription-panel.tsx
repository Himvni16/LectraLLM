"use client";

import { useState } from "react";

import type { TranscriptionSuccessResponse } from "@/lib/transcription/types";

interface AnalysisView {
  id: string;
  videoFileName: string;
  pdfFileName: string;
  status: string;
  transcriptText: string | null;
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
  EXTRACTING_TOPICS: "Extracting topics",
  COMPARING: "Comparing",
  COMPLETED: "Completed",
  FAILED: "Transcription failed",
};

export function TranscriptionPanel({ initialAnalysis }: TranscriptionPanelProps) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canTranscribe =
    analysis.status === "UPLOADED" || analysis.status === "FAILED";

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

        {error ? (
          <p
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </aside>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
          Lecture transcript
        </p>
        {analysis.transcriptText ? (
          <p className="mt-5 whitespace-pre-wrap text-base leading-8 text-slate-700">
            {analysis.transcriptText}
          </p>
        ) : (
          <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm leading-6 text-slate-600">
            {isTranscribing
              ? "The local AI service is transcribing this lecture. Longer videos can take several minutes on CPU."
              : "No transcript has been generated yet."}
          </div>
        )}
      </section>
    </div>
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
