import {
  AnalysisStatus,
  MatchType,
  Prisma,
  TopicSource,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { UploadLimits } from "@/lib/env";
import { extractAnalysisPdf } from "@/lib/pdf-extraction/workflow";
import type {
  AiTopicComparisonMatch,
  TopicComparisonRepository,
} from "@/lib/topic-comparison/types";
import { compareAnalysisTopics } from "@/lib/topic-comparison/workflow";
import type {
  ExtractedTopic,
  TopicExtractionRepository,
} from "@/lib/topic-extraction/types";
import { extractAnalysisTopics } from "@/lib/topic-extraction/workflow";
import { transcribeAnalysis } from "@/lib/transcription/workflow";
import { createAnalysisUpload } from "@/lib/uploads/analysis-upload";
import type {
  AnalysisRepository,
  UploadedAnalysisData,
  UploadStorage,
} from "@/lib/uploads/types";

interface StoredTopic {
  id: string;
  name: string;
  confidence: number | null;
  source: TopicSource;
}

interface WorkflowState extends UploadedAnalysisData {
  id: string;
  topics: StoredTopic[];
  matches: AiTopicComparisonMatch[];
  statusHistory: AnalysisStatus[];
}

const limits: UploadLimits = {
  videoMaxSizeMb: 10,
  pdfMaxSizeMb: 5,
  videoMaxSizeBytes: 1024,
  pdfMaxSizeBytes: 1024,
};

describe("complete analysis workflow", () => {
  it("persists every Phase 2-7 output and reaches COMPLETED with mocked AI boundaries", async () => {
    const leaseToken = "lease-1";
    let state: WorkflowState | undefined;

    const setStatus = (status: AnalysisStatus) => {
      if (!state) throw new Error("Analysis has not been created.");
      state.status = status;
      if (state.statusHistory.at(-1) !== status) state.statusHistory.push(status);
    };

    const uploadRepository: AnalysisRepository = {
      createUploaded: vi.fn(async (data) => {
        const createdState: WorkflowState = {
          ...data,
          id: "analysis-e2e",
          topics: [],
          matches: [],
          statusHistory: [AnalysisStatus.UPLOADED],
        };
        state = createdState;
        return {
          id: createdState.id,
          status: createdState.status,
          videoFileName: createdState.videoFileName,
          pdfFileName: createdState.pdfFileName,
        };
      }),
    };
    const storage: UploadStorage = {
      save: vi.fn(async (_file, kind, extension) => ({
        storagePath: `storage/${kind === "video" ? "videos" : "pdfs"}/generated${extension}`,
        cleanupPath: `C:\\private\\generated${extension}`,
      })),
      remove: vi.fn(async () => undefined),
    };

    const upload = await createAnalysisUpload(
      {
        video: new File(["video"], "lecture.mp4", { type: "video/mp4" }),
        pdf: new File(["pdf"], "slides.pdf", { type: "application/pdf" }),
      },
      limits,
      { repository: uploadRepository, storage },
    );

    expect(upload.status).toBe(AnalysisStatus.UPLOADED);
    if (!state) throw new Error("Upload did not create an analysis.");

    await transcribeAnalysis(state.id, {
      videoLocator: {
        locate: vi.fn(async () => ({
          absolutePath: "C:\\private\\generated.mp4",
          fileName: "lecture.mp4",
        })),
      },
      client: {
        transcribe: vi.fn(async () => ({
          text: " Deadlocks and resource allocation graphs. ",
          language: "en",
          durationSeconds: 60,
          segments: [],
          model: "mock-whisper",
        })),
      },
      leaseToken,
      repository: {
        findById: vi.fn(async () => ({
          id: state!.id,
          videoFileName: state!.videoFileName,
          pdfFileName: state!.pdfFileName,
          videoStoragePath: state!.videoStoragePath,
          status: state!.status,
          transcriptText: state!.transcriptText,
        })),
        claim: vi.fn(async () => {
          setStatus(AnalysisStatus.TRANSCRIBING);
          return true;
        }),
        complete: vi.fn(async (_id, transcriptText) => {
          state!.transcriptText = transcriptText;
          setStatus(AnalysisStatus.EXTRACTING_PDF);
          return true;
        }),
        fail: vi.fn(async () => setStatus(AnalysisStatus.FAILED)),
      },
    });

    await extractAnalysisPdf(state.id, {
      pdfLocator: {
        locate: vi.fn(async () => ({
          absolutePath: "C:\\private\\generated.pdf",
          fileName: "slides.pdf",
        })),
      },
      client: {
        extract: vi.fn(async () => ({
          text: " Deadlock prevention and virtual memory. ",
          pageCount: 4,
          characterCount: 41,
        })),
      },
      leaseToken,
      repository: {
        findById: vi.fn(async () => ({
          id: state!.id,
          videoFileName: state!.videoFileName,
          pdfFileName: state!.pdfFileName,
          pdfStoragePath: state!.pdfStoragePath,
          status: state!.status,
          transcriptText: state!.transcriptText,
          pdfText: state!.pdfText,
        })),
        claim: vi.fn(async () => true),
        complete: vi.fn(async (_id, pdfText) => {
          state!.pdfText = pdfText;
          setStatus(AnalysisStatus.EXTRACTING_TOPICS);
          return true;
        }),
        fail: vi.fn(async () => setStatus(AnalysisStatus.FAILED)),
      },
    });

    const videoTopics: ExtractedTopic[] = [
      { name: "Deadlocks", confidence: 0.95 },
      { name: "Resource Allocation Graphs", confidence: 0.9 },
    ];
    const pdfTopics: ExtractedTopic[] = [
      { name: "Deadlock Prevention", confidence: 0.92 },
      { name: "Virtual Memory", confidence: 0.88 },
    ];
    const topicRepository: TopicExtractionRepository = {
      findById: vi.fn(async () => ({
        id: state!.id,
        status: state!.status,
        transcriptText: state!.transcriptText,
        pdfText: state!.pdfText,
      })),
      claim: vi.fn(async () => true),
      replaceAndComplete: vi.fn(async (_id, video, pdf) => {
        state!.topics = [
          ...video.map((topic: ExtractedTopic, index: number) => ({
            id: `video-${index + 1}`,
            ...topic,
            source: TopicSource.VIDEO,
          })),
          ...pdf.map((topic: ExtractedTopic, index: number) => ({
            id: `pdf-${index + 1}`,
            ...topic,
            source: TopicSource.PDF,
          })),
        ];
        setStatus(AnalysisStatus.COMPARING);
        return true;
      }),
      fail: vi.fn(async () => setStatus(AnalysisStatus.FAILED)),
    };

    await extractAnalysisTopics(state.id, {
      leaseToken,
      repository: topicRepository,
      client: {
        extract: vi.fn(async (_text, source) => ({
          topics: source === TopicSource.VIDEO ? videoTopics : pdfTopics,
        })),
      },
    });

    const comparisonRepository: TopicComparisonRepository = {
      findById: vi.fn(async () => ({
        id: state!.id,
        status: state!.status,
        topics: state!.topics,
      })),
      claim: vi.fn(async () => true),
      replaceAndComplete: vi.fn(async (_id, matches, score) => {
        state!.matches = [...matches];
        state!.overallSimilarityScore = score;
        setStatus(AnalysisStatus.COMPLETED);
        return true;
      }),
      fail: vi.fn(async () => setStatus(AnalysisStatus.FAILED)),
    };

    await compareAnalysisTopics(state.id, {
      leaseToken,
      repository: comparisonRepository,
      client: {
        compare: vi.fn(async () => ({
          matches: [
            {
              pdfTopicId: "pdf-1",
              videoTopicId: "video-1",
              similarityScore: 0.8,
              matchType: MatchType.STRONG,
            },
            {
              pdfTopicId: "pdf-2",
              videoTopicId: null,
              similarityScore: 0.2,
              matchType: MatchType.MISSING,
            },
          ],
        })),
      },
    });

    expect(state.statusHistory).toEqual([
      AnalysisStatus.UPLOADED,
      AnalysisStatus.TRANSCRIBING,
      AnalysisStatus.EXTRACTING_PDF,
      AnalysisStatus.EXTRACTING_TOPICS,
      AnalysisStatus.COMPARING,
      AnalysisStatus.COMPLETED,
    ]);
    expect(state.transcriptText).toBe(
      "Deadlocks and resource allocation graphs.",
    );
    expect(state.pdfText).toBe("Deadlock prevention and virtual memory.");
    expect(state.topics.filter((topic) => topic.source === TopicSource.VIDEO)).toHaveLength(2);
    expect(state.topics.filter((topic) => topic.source === TopicSource.PDF)).toHaveLength(2);
    expect(state.matches).toHaveLength(2);
    expect(state.matches[1]).toMatchObject({
      pdfTopicId: "pdf-2",
      videoTopicId: null,
      matchType: MatchType.MISSING,
    });
    expect(state.overallSimilarityScore).toBeInstanceOf(Prisma.Decimal);
    expect(String(state.overallSimilarityScore)).toBe("50");
    expect(state.status).toBe(AnalysisStatus.COMPLETED);
  });
});
