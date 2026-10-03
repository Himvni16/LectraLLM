"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [video, setVideo] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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

      const result = payload as UploadSuccessResponse;
      router.push(`/analyses/${encodeURIComponent(result.analysisId)}`);
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
    <div className="mt-10 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <form
        className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8"
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
            className="mt-6 rounded-lg border border-zinc-400 bg-zinc-100 px-4 py-3 text-sm text-zinc-900"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 sm:w-auto"
          disabled={isSubmitting || !video || !pdf}
          type="submit"
        >
          {isSubmitting ? "Uploading & preparing…" : "Upload & Analyze"}
        </button>
      </form>

      <aside aria-live="polite">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-100 p-5 text-sm leading-6 text-zinc-600 sm:p-6">
          Both files are validated on the server. After upload, LectraLLM opens
          the analysis page and automatically runs transcription, extraction,
          and comparison.
        </div>
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
      <label className="block text-sm font-semibold text-zinc-900" htmlFor={id}>
        {label}
      </label>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      <input
        accept={accept}
        className="mt-3 block w-full min-w-0 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 sm:file:mr-4 sm:file:px-4"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
      <p className="mt-2 break-all text-sm text-zinc-700">
        {file ? file.name : "No file selected"}
      </p>
    </div>
  );
}
