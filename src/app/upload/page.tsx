import type { Metadata } from "next";

import { UploadForm } from "@/components/upload-form";
import { PageHeader, PageShell } from "@/components/ui";
import { getUploadLimits } from "@/lib/env";

export const metadata: Metadata = {
  title: "Upload Lecture | LectraLLM",
  description: "Upload one lecture video and its corresponding PDF.",
};

export const dynamic = "force-dynamic";

export default function UploadPage() {
  const limits = getUploadLimits();

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl">
        <PageHeader
          description="Add a lecture video and the PDF material it should cover. The analysis starts automatically after upload."
          eyebrow="New analysis"
          title="Analyze lecture"
        />
        <UploadForm limits={limits} />
      </section>
    </PageShell>
  );
}
