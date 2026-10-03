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
    <div className="upload-workspace mt-10 max-w-3xl min-w-0 sm:mt-12">
      <form
        className="min-w-0 border-t border-zinc-200"
        onSubmit={handleSubmit}
      >
        <div className="grid divide-y divide-zinc-200 border-b border-zinc-200 md:grid-cols-2 md:divide-x md:divide-y-0">
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
            className="mt-5 rounded-lg border border-zinc-400 bg-zinc-100 px-4 py-3 text-sm text-zinc-900 sm:mt-6"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 sm:mt-6 sm:w-auto"
          disabled={isSubmitting || !video || !pdf}
          type="submit"
        >
          {isSubmitting ? "Uploading & preparing…" : "Upload & Analyze"}
        </button>
      </form>

      <p aria-live="polite" className="mt-4 max-w-2xl text-xs leading-5 text-zinc-500">
        Both files are validated before the analysis opens. Transcription,
        extraction, and comparison then run automatically.
      </p>
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
  const descriptionId = `${id}-description`;
  const labelId = `${id}-label`;

  return (
    <div className="min-w-0 py-5 md:py-6 md:first:pr-6 md:last:pl-6">
      <p className="text-sm font-semibold text-zinc-900" id={labelId}>
        {label}
      </p>
      <p className="mt-1 text-sm text-zinc-500" id={descriptionId}>
        {description}
      </p>
      <input
        accept={accept}
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        className="peer sr-only"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
      <label
        className={`group mt-3 flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black ${
          file
            ? "border-zinc-300 bg-zinc-100 hover:border-zinc-400"
            : "border-zinc-300 bg-transparent hover:border-zinc-500"
        }`}
        htmlFor={id}
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
            {file ? "Selected file" : "Select file"}
          </span>
          <span className="mt-1 block truncate text-sm font-medium text-black">
            {file ? file.name : "Choose from your device"}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-black px-4 text-sm font-medium text-white transition group-hover:bg-zinc-700"
        >
          Browse
        </span>
      </label>
    </div>
  );
}
