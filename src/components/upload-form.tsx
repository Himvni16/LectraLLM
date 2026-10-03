"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, FilePicker } from "@/components/ui";
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
    <div className="upload-workspace mt-12 max-w-3xl min-w-0">
      <form
        className="min-w-0 border-t border-zinc-200"
        onSubmit={handleSubmit}
      >
        <div className="grid divide-y divide-zinc-200 border-b border-zinc-200 md:grid-cols-2 md:divide-x md:divide-y-0">
          <FilePicker
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            description={`MP4, MOV, or WebM · up to ${limits.videoMaxSizeMb} MB`}
            file={video}
            id="lecture-video"
            label="Lecture video"
            onChange={setVideo}
          />

          <FilePicker
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

        <Button
          className="mt-6 w-full sm:w-auto"
          disabled={isSubmitting || !video || !pdf}
          type="submit"
        >
          {isSubmitting ? "Uploading & preparing…" : "Upload & Analyze"}
        </Button>
      </form>

      <p
        aria-live="polite"
        className="mt-4 max-w-2xl text-xs leading-5 text-zinc-500"
      >
        Both files are validated before the analysis opens. Transcription,
        extraction, and comparison then run automatically.
      </p>
    </div>
  );
}
