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
    <main className="page-shell mx-auto max-w-[70rem] px-4 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          New analysis
        </p>
        <h1 className="mt-6 text-5xl font-semibold tracking-[-0.045em] text-black sm:text-6xl">
          Analyze lecture
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
          Add a lecture video and the PDF material it should cover. The analysis
          starts automatically after upload.
        </p>
        <UploadForm limits={limits} />
      </section>
    </main>
  );
}
