import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isValidAnalysisId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!isValidAnalysisId(id)) {
    return NextResponse.json(
      { error: { code: "INVALID_ANALYSIS_ID", message: "The analysis ID is invalid." } },
      { status: 400 },
    );
  }

  try {
    const analysis = await withPrismaRetry("analysis.loadStatus", () =>
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
      return NextResponse.json(
        { error: { code: "ANALYSIS_NOT_FOUND", message: "Analysis was not found." } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: analysis.id,
      videoFileName: analysis.videoFileName,
      pdfFileName: analysis.pdfFileName,
      status: analysis.status,
      transcriptText: analysis.transcriptText,
      pdfText: analysis.pdfText,
      overallSimilarityScore:
        analysis.overallSimilarityScore?.toNumber() ?? null,
      topics: analysis.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        source: topic.source,
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
    });
  } catch (error) {
    console.error("Analysis status lookup failed.", error);
    return NextResponse.json(
      {
        error: {
          code: "ANALYSIS_STATUS_UNAVAILABLE",
          message: "The analysis status could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
