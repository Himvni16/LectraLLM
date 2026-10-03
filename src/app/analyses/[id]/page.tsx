import type { Metadata } from "next";
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
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <section>
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
              matchType: match.matchType,
            })),
          }}
        />
      </section>
    </main>
  );
}
