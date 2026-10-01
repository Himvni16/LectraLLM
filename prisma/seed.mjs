import {
  AnalysisStatus,
  MatchType,
  PrismaClient,
  TopicSource,
} from "@prisma/client";

const prisma = new PrismaClient();

const seedIds = {
  analysis: "seed-sample-analysis",
  videoDeadlocks: "seed-video-deadlocks",
  videoPrevention: "seed-video-deadlock-prevention",
  pdfDeadlocks: "seed-pdf-deadlocks",
  pdfPrevention: "seed-pdf-deadlock-prevention",
  pdfRecovery: "seed-pdf-deadlock-recovery",
};

async function main() {
  await prisma.$transaction(async (transaction) => {
    await transaction.analysis.deleteMany({
      where: { id: seedIds.analysis },
    });

    await transaction.analysis.create({
      data: {
        id: seedIds.analysis,
        videoFileName: "sample-lecture.mp4",
        pdfFileName: "sample-notes.pdf",
        videoStoragePath: "development/sample-lecture.mp4",
        pdfStoragePath: "development/sample-notes.pdf",
        status: AnalysisStatus.COMPLETED,
        overallSimilarityScore: "86.50",
        topics: {
          create: [
            {
              id: seedIds.videoDeadlocks,
              name: "Deadlocks",
              source: TopicSource.VIDEO,
              confidenceScore: "0.9800",
            },
            {
              id: seedIds.videoPrevention,
              name: "Deadlock Prevention",
              source: TopicSource.VIDEO,
              confidenceScore: "0.9500",
            },
            {
              id: seedIds.pdfDeadlocks,
              name: "Deadlocks",
              source: TopicSource.PDF,
              confidenceScore: "0.9900",
            },
            {
              id: seedIds.pdfPrevention,
              name: "Deadlock Prevention",
              source: TopicSource.PDF,
              confidenceScore: "0.9700",
            },
            {
              id: seedIds.pdfRecovery,
              name: "Deadlock Recovery",
              source: TopicSource.PDF,
              confidenceScore: "0.9300",
            },
          ],
        },
      },
    });

    await transaction.topicMatch.createMany({
      data: [
        {
          analysisId: seedIds.analysis,
          videoTopicId: seedIds.videoDeadlocks,
          pdfTopicId: seedIds.pdfDeadlocks,
          similarityScore: "0.9900",
          matchType: MatchType.STRONG,
        },
        {
          analysisId: seedIds.analysis,
          videoTopicId: seedIds.videoPrevention,
          pdfTopicId: seedIds.pdfPrevention,
          similarityScore: "0.9600",
          matchType: MatchType.STRONG,
        },
      ],
    });
  });

  console.log("Seeded the Phase 1 sample analysis.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
