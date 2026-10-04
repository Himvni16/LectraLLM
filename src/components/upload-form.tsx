"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, FilePicker } from "@/components/ui";
import type { UploadLimits } from "@/lib/env";
import type {
  FinalizeUploadResponse,
  InitiateUploadResponse,
  UploadSuccessResponse,
} from "@/lib/uploads/types";
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ErrorResponse;
  if (!response.ok) {
    const message = (payload as ErrorResponse | null)?.error?.message;
    throw new Error(message ?? "The lecture could not be uploaded.");
  }
  return payload as T;
}

async function uploadVideoToCloudinary(
  file: File,
  instructions: InitiateUploadResponse["video"],
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", instructions.apiKey);
  formData.append("timestamp", String(instructions.timestamp));
  formData.append("signature", instructions.signature);
  formData.append("public_id", instructions.publicId);
  formData.append("overwrite", "false");
  formData.append("type", "authenticated");
  const response = await fetch(instructions.uploadUrl, {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as {
    public_id?: unknown;
    resource_type?: unknown;
    bytes?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The video upload failed.");
  }
  if (
    payload.public_id !== instructions.publicId ||
    payload.resource_type !== "video" ||
    payload.bytes !== file.size
  ) {
    throw new Error("Cloudinary returned unexpected video metadata.");
  }
}

async function uploadPdfToSupabase(
  file: File,
  instructions: InitiateUploadResponse["pdf"],
): Promise<void> {
  const formData = new FormData();
  formData.append("cacheControl", "3600");
  formData.append("", file);
  const response = await fetch(instructions.signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: formData,
  });
  if (!response.ok) throw new Error("The PDF upload failed.");
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

    setIsSubmitting(true);

    let initiatedManifest: string | undefined;

    try {
      const initiateResponse = await fetch("/api/uploads/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [
            {
              source: "VIDEO",
              originalFileName: video.name,
              contentType: video.type,
              size: video.size,
            },
            {
              source: "PDF",
              originalFileName: pdf.name,
              contentType: pdf.type,
              size: pdf.size,
            },
          ],
        }),
      });
      const initiated = await readJsonResponse<InitiateUploadResponse>(
        initiateResponse,
      );
      initiatedManifest = initiated.uploadManifest;

      await uploadVideoToCloudinary(video, initiated.video);
      await uploadPdfToSupabase(pdf, initiated.pdf);

      const finalizeResponse = await fetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadManifest: initiated.uploadManifest,
        }),
      });
      const finalized = await readJsonResponse<FinalizeUploadResponse>(
        finalizeResponse,
      );

      const analysisResponse = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadManifest: finalized.uploadManifest }),
      });
      const result = await readJsonResponse<UploadSuccessResponse>(
        analysisResponse,
      );

      router.push(`/analyses/${encodeURIComponent(result.analysisId)}`);
    } catch (submissionError) {
      if (initiatedManifest) {
        void fetch("/api/uploads/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadManifest: initiatedManifest }),
        }).catch(() => undefined);
      }
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
