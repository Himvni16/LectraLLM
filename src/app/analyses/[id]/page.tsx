import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TranscriptionPanel } from "@/components/transcription-panel";
import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";

export const metadata: Metadata = {
  title: "Lecture Analysis | LectraLLM",
  description: "View extracted topics and lecture-to-PDF coverage results.",
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
        overallSimilarityScore: true,
        topics: {
          select: {
            id: true,
            name: true,
            source: true,
            confidenceScore: true,
          },
          orderBy: [{ source: "asc" }, { createdAt: "asc" }],
        },
        topicMatches: {
          select: {
            id: true,
            similarityScore: true,
            matchType: true,
            pdfTopic: { select: { id: true, name: true } },
            videoTopic: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
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
          Review the source text, extracted topics, and PDF coverage comparison.
        </p>
        <TranscriptionPanel
          initialAnalysis={{
            id: analysis.id,
            videoFileName: analysis.videoFileName,
            pdfFileName: analysis.pdfFileName,
            status: analysis.status.toString(),
            transcriptText: analysis.transcriptText,
            pdfText: analysis.pdfText,
            overallSimilarityScore:
              analysis.overallSimilarityScore?.toNumber() ?? null,
            topics: analysis.topics.map((topic) => ({
              id: topic.id,
              name: topic.name,
              source: topic.source.toString(),
              confidence: topic.confidenceScore?.toNumber() ?? null,
            })),
            comparisonMatches: analysis.topicMatches.map((match) => ({
              id: match.id,
              pdfTopicId: match.pdfTopic.id,
              pdfTopicName: match.pdfTopic.name,
              videoTopicId: match.videoTopic?.id ?? null,
              videoTopicName: match.videoTopic?.name ?? null,
              similarityScore: match.similarityScore.toNumber(),
              matchType: match.matchType.toString(),
            })),
          }}
        />
      </section>
    </main>
  );
}
