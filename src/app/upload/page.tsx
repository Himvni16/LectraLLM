import type { Metadata } from "next";

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
    <main className="page-shell mx-auto max-w-6xl px-4 sm:px-6 lg:px-10">
      <section className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          New analysis
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-5xl">
          Analyze lecture
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
          Add a lecture video and the PDF material it should cover. The analysis
          starts automatically after upload.
        </p>
        <UploadForm limits={limits} />
      </section>
    </main>
  );
}
