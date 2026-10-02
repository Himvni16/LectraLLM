import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TranscriptionPanel } from "@/components/transcription-panel";
import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";

export const metadata: Metadata = {
  title: "Lecture Analysis | LectraLLM",
  description: "View the lecture transcript and extracted PDF text.",
};

export const dynamic = "force-dynamic";

interface AnalysisPageProps {
  params: Promise<{ id: string }>;
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const { id } = await params;
  const analysis = await withPrismaRetry("analysis.loadPage", () =>
    prisma.analysis.findUnique({
      where: { id },
      select: {
        id: true,
        videoFileName: true,
        pdfFileName: true,
        status: true,
        transcriptText: true,
        pdfText: true,
      },
    }),
  );

  if (!analysis) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-6 py-12 sm:px-10 sm:py-16">
      <Link
        className="text-sm font-medium text-blue-700 hover:text-blue-900"
        href="/upload"
      >
        ← Upload another lecture
      </Link>
      <section className="mt-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          Analysis
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Lecture processing
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Review the lecture transcript and extract readable text from its
          corresponding PDF.
        </p>
        <TranscriptionPanel
          initialAnalysis={{ ...analysis, status: analysis.status.toString() }}
        />
      </section>
    </main>
  );
}
