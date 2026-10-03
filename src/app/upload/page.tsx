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
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <section>
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
