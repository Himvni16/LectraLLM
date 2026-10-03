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
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <Link
        className="rounded text-sm font-medium text-zinc-600 transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950"
        href="/"
      >
        ← Back to home
      </Link>
      <section className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600 sm:text-sm">
          New analysis
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-5xl">
          Upload to LectraLLM
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
          Select one lecture video and the corresponding PDF. LectraLLM will
          upload both files and run the full analysis automatically.
        </p>
        <UploadForm limits={limits} />
      </section>
    </main>
  );
}
