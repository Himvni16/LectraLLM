import type { Metadata } from "next";
import Link from "next/link";

import { UploadForm } from "@/components/upload-form";
import { getUploadLimits } from "@/lib/env";

export const metadata: Metadata = {
  title: "Upload Lecture | LectraLLM",
  description: "Upload one lecture video and its corresponding PDF.",
};

export const dynamic = "force-dynamic";

export default function UploadPage() {
  const limits = getUploadLimits();

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-6 py-12 sm:px-10 sm:py-16">
      <Link
        className="text-sm font-medium text-blue-700 hover:text-blue-900"
        href="/"
      >
        ← Back to home
      </Link>
      <section className="mt-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          New analysis
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Upload to LectraLLM
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Select one lecture video and the corresponding PDF. This phase stores
          both files securely for later comparison.
        </p>
        <UploadForm limits={limits} />
      </section>
    </main>
  );
}
