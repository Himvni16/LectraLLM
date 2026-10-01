"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import type { UploadLimits } from "@/lib/env";
import type { UploadSuccessResponse } from "@/lib/uploads/types";
import {
  UploadRequestError,
  validateUploadPair,
} from "@/lib/uploads/validation";

interface UploadFormProps {
  limits: UploadLimits;
}

interface ErrorResponse {
  error?: {
    message?: string;
  };
}

export function UploadForm({ limits }: UploadFormProps) {
  const [video, setVideo] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadSuccessResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!video || !pdf) {
      setError("Select one lecture video and one corresponding PDF.");
      return;
    }

    try {
      validateUploadPair({ video, pdf }, limits);
    } catch (validationError) {
      setError(
        validationError instanceof UploadRequestError
          ? validationError.message
          : "The selected files are invalid.",
      );
      return;
    }

    const formData = new FormData();
    formData.append("video", video);
    formData.append("pdf", pdf);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as
        | UploadSuccessResponse
        | ErrorResponse;

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error?.message : undefined;
        throw new Error(message ?? "The lecture could not be uploaded.");
      }

      setResult(payload as UploadSuccessResponse);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The lecture could not be uploaded.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        onSubmit={handleSubmit}
      >
        <div className="space-y-7">
          <FileField
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            description={`MP4, MOV, or WebM · up to ${limits.videoMaxSizeMb} MB`}
            file={video}
            id="lecture-video"
            label="Lecture video"
            onChange={setVideo}
          />

          <FileField
            accept=".pdf,application/pdf"
            description={`PDF only · up to ${limits.pdfMaxSizeMb} MB`}
            file={pdf}
            id="lecture-pdf"
            label="Corresponding PDF"
            onChange={setPdf}
          />
        </div>

        {error ? (
          <p
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
          disabled={isSubmitting || !video || !pdf}
          type="submit"
        >
          {isSubmitting ? "Uploading…" : "Upload lecture"}
        </button>
      </form>

      <aside aria-live="polite">
        {result ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">
              Upload complete
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Lecture uploaded successfully
            </h2>
            <dl className="mt-6 space-y-4 text-sm">
              <ResultRow label="Video" value={result.videoFileName} />
              <ResultRow label="PDF" value={result.pdfFileName} />
              <ResultRow label="Status" value="Uploaded" />
              <ResultRow label="Analysis ID" value={result.analysisId} />
            </dl>
            <Link
              className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
              href={`/analyses/${encodeURIComponent(result.analysisId)}`}
            >
              Open analysis
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm leading-6 text-slate-600">
            Both files are validated on the server. Uploading only stores the
            files and creates an analysis reference; processing begins in later
            phases.
          </div>
        )}
      </aside>
    </div>
  );
}

interface FileFieldProps {
  accept: string;
  description: string;
  file: File | null;
  id: string;
  label: string;
  onChange: (file: File | null) => void;
}

function FileField({
  accept,
  description,
  file,
  id,
  label,
  onChange,
}: FileFieldProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-900" htmlFor={id}>
        {label}
      </label>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <input
        accept={accept}
        className="mt-3 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:font-semibold file:text-blue-800 hover:file:bg-blue-100"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
      <p className="mt-2 truncate text-sm text-slate-700">
        {file ? file.name : "No file selected"}
      </p>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-emerald-700">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}
