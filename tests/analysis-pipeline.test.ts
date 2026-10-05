import { AnalysisStatus, TopicSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSingleFlightRunner } from "@/lib/analysis-pipeline/concurrency";
import {
  getAnalysisStatusLabel,
  shouldPollAnalysis,
} from "@/lib/analysis-pipeline/presentation";
import {
  determineResumeStage,
  type AnalysisResumeSnapshot,
} from "@/lib/analysis-pipeline/resume";
import {
  ANALYSIS_LEASE_DURATION_MS,
  executeAnalysisPipeline,
  type AnalysisPipelineDependencies,
} from "@/lib/analysis-pipeline/workflow";

const now = new Date("2026-10-05T00:00:00.000Z");
const token = "lease-1";

function snapshot(
  status: AnalysisStatus,
  overrides: Partial<AnalysisResumeSnapshot> = {},
): AnalysisResumeSnapshot {
  return {
    id: "analysis-1",
    status,
    transcriptText: null,
    pdfText: null,
    hasOverallSimilarityScore: false,
    topics: [],
    topicMatches: [],
    ...overrides,
  };
}

function completeTopics() {
  return [
    { id: "video-1", source: TopicSource.VIDEO },
    { id: "pdf-1", source: TopicSource.PDF },
  ];
}

function dependencies(initial: AnalysisResumeSnapshot, leaseAvailable = true) {
  let current = initial;
  const repository: AnalysisPipelineDependencies["repository"] = {
    findById: vi.fn(async () => current),
    claimLease: vi.fn(async (input) => {
      if (!leaseAvailable) return false;
      current = { ...current, status: input.claimedStatus };
      return true;
    }),
    advanceWithLease: vi.fn(async (_id, _token, status) => {
      current = { ...current, status };
      return true;
    }),
    releaseLease: vi.fn(async () => true),
  };
  const transcribe = vi.fn(async () => {
    current = { ...current, status: AnalysisStatus.EXTRACTING_PDF };
  });
  const extractPdf = vi.fn(async () => {
    current = { ...current, status: AnalysisStatus.EXTRACTING_TOPICS };
  });
  const extractTopics = vi.fn(async () => {
    current = { ...current, status: AnalysisStatus.COMPARING };
  });
  const compareTopics = vi.fn(async () => {
    current = { ...current, status: AnalysisStatus.COMPLETED };
  });
  const deps: AnalysisPipelineDependencies = {
    repository,
    transcribe,
    extractPdf,
    extractTopics,
    compareTopics,
    createToken: () => token,
    now: () => now,
  };
  return {
    deps,
    repository,
    transcribe,
    extractPdf,
    extractTopics,
    compareTopics,
  };
}

describe("one-stage analysis orchestration", () => {
  it("runs transcription only for an UPLOADED analysis", async () => {
    const setup = dependencies(snapshot(AnalysisStatus.UPLOADED));

    await expect(
      executeAnalysisPipeline("analysis-1", setup.deps),
    ).resolves.toEqual({
      analysisId: "analysis-1",
      status: AnalysisStatus.EXTRACTING_PDF,
      workPerformed: true,
      requiresAnotherRun: true,
    });
    expect(setup.transcribe).toHaveBeenCalledWith("analysis-1", token);
    expect(setup.extractPdf).not.toHaveBeenCalled();
    expect(setup.extractTopics).not.toHaveBeenCalled();
    expect(setup.compareTopics).not.toHaveBeenCalled();
    expect(setup.repository.claimLease).toHaveBeenCalledWith({
      id: "analysis-1",
      expectedStatus: AnalysisStatus.UPLOADED,
      claimedStatus: AnalysisStatus.UPLOADED,
      token,
      now,
      expiresAt: new Date(now.getTime() + ANALYSIS_LEASE_DURATION_MS),
    });
  });

  it.each([
    [
      AnalysisStatus.EXTRACTING_PDF,
      { transcriptText: "Transcript" },
      "extractPdf",
      AnalysisStatus.EXTRACTING_TOPICS,
    ],
    [
      AnalysisStatus.EXTRACTING_TOPICS,
      { transcriptText: "Transcript", pdfText: "PDF text" },
      "extractTopics",
      AnalysisStatus.COMPARING,
    ],
    [
      AnalysisStatus.COMPARING,
      {
        transcriptText: "Transcript",
        pdfText: "PDF text",
        topics: completeTopics(),
      },
      "compareTopics",
      AnalysisStatus.COMPLETED,
    ],
  ] as const)(
    "runs only the %s stage",
    async (status, overrides, operation, expectedStatus) => {
      const setup = dependencies(snapshot(status, overrides));
      const result = await executeAnalysisPipeline("analysis-1", setup.deps);

      expect(setup[operation]).toHaveBeenCalledOnce();
      const calls = [
        setup.transcribe,
        setup.extractPdf,
        setup.extractTopics,
        setup.compareTopics,
      ].reduce((total, mock) => total + mock.mock.calls.length, 0);
      expect(calls).toBe(1);
      expect(result.status).toBe(expectedStatus);
    },
  );

  it("advances TRANSCRIBING recovery without retranscribing persisted text", async () => {
    const setup = dependencies(
      snapshot(AnalysisStatus.TRANSCRIBING, {
        transcriptText: "Persisted transcript",
      }),
    );

    await expect(
      executeAnalysisPipeline("analysis-1", setup.deps),
    ).resolves.toMatchObject({
      status: AnalysisStatus.EXTRACTING_PDF,
      workPerformed: true,
    });
    expect(setup.transcribe).not.toHaveBeenCalled();
    expect(setup.repository.advanceWithLease).toHaveBeenCalledWith(
      "analysis-1",
      token,
      AnalysisStatus.EXTRACTING_PDF,
      now,
    );
  });

  it.each([
    [
      "PDF text",
      snapshot(AnalysisStatus.EXTRACTING_PDF, {
        transcriptText: "Transcript",
        pdfText: "Persisted PDF",
      }),
      "extractPdf",
      AnalysisStatus.EXTRACTING_TOPICS,
    ],
    [
      "topics",
      snapshot(AnalysisStatus.EXTRACTING_TOPICS, {
        transcriptText: "Transcript",
        pdfText: "PDF",
        topics: completeTopics(),
      }),
      "extractTopics",
      AnalysisStatus.COMPARING,
    ],
    [
      "comparison",
      snapshot(AnalysisStatus.COMPARING, {
        transcriptText: "Transcript",
        pdfText: "PDF",
        topics: completeTopics(),
        hasOverallSimilarityScore: true,
        topicMatches: [{ pdfTopicId: "pdf-1" }],
      }),
      "compareTopics",
      AnalysisStatus.COMPLETED,
    ],
  ] as const)(
    "does not rerun already persisted %s",
    async (_label, analysis, operation, expectedStatus) => {
      const setup = dependencies(analysis);
      const result = await executeAnalysisPipeline("analysis-1", setup.deps);
      expect(setup[operation]).not.toHaveBeenCalled();
      expect(result.status).toBe(expectedStatus);
    },
  );

  it("resumes FAILED from the earliest incomplete stage", async () => {
    const setup = dependencies(
      snapshot(AnalysisStatus.FAILED, { transcriptText: "Transcript" }),
    );

    await executeAnalysisPipeline("analysis-1", setup.deps);
    expect(setup.extractPdf).toHaveBeenCalledOnce();
    expect(setup.transcribe).not.toHaveBeenCalled();
    expect(setup.extractTopics).not.toHaveBeenCalled();
  });

  it("does no work for COMPLETED or an overlapping valid lease", async () => {
    const completed = dependencies(snapshot(AnalysisStatus.COMPLETED));
    await expect(
      executeAnalysisPipeline("analysis-1", completed.deps),
    ).resolves.toMatchObject({ workPerformed: false, requiresAnotherRun: false });
    expect(completed.repository.claimLease).not.toHaveBeenCalled();

    const overlap = dependencies(snapshot(AnalysisStatus.TRANSCRIBING), false);
    await expect(
      executeAnalysisPipeline("analysis-1", overlap.deps),
    ).resolves.toMatchObject({
      status: AnalysisStatus.TRANSCRIBING,
      workPerformed: false,
      requiresAnotherRun: true,
    });
    expect(overlap.transcribe).not.toHaveBeenCalled();
  });

  it.each([
    [
      AnalysisStatus.EXTRACTING_TOPICS,
      { transcriptText: "Transcript", pdfText: "PDF" },
      "extractTopics",
    ],
    [
      AnalysisStatus.COMPARING,
      {
        transcriptText: "Transcript",
        pdfText: "PDF",
        topics: completeTopics(),
      },
      "compareTopics",
    ],
  ] as const)(
    "prevents overlapping %s calls from duplicating persisted rows",
    async (status, overrides, operation) => {
      const setup = dependencies(snapshot(status, overrides), false);
      await executeAnalysisPipeline("analysis-1", setup.deps);
      expect(setup[operation]).not.toHaveBeenCalled();
    },
  );

  it("derives resume stages deterministically from persisted artifacts", () => {
    expect(determineResumeStage(snapshot(AnalysisStatus.FAILED))).toBe(
      "transcription",
    );
    expect(
      determineResumeStage(
        snapshot(AnalysisStatus.FAILED, { transcriptText: "Transcript" }),
      ),
    ).toBe("pdf-extraction");
    expect(
      determineResumeStage(
        snapshot(AnalysisStatus.FAILED, {
          transcriptText: "Transcript",
          pdfText: "PDF",
        }),
      ),
    ).toBe("topic-extraction");
    expect(
      determineResumeStage(
        snapshot(AnalysisStatus.FAILED, {
          transcriptText: "Transcript",
          pdfText: "PDF",
          topics: completeTopics(),
        }),
      ),
    ).toBe("comparison");
  });

  it("shares duplicate in-process requests while the database lease protects other instances", async () => {
    let finish: (() => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve("complete");
        }),
    );
    const runOnce = createSingleFlightRunner(operation);
    const first = runOnce("analysis-1");
    const duplicate = runOnce("analysis-1");
    expect(first).toBe(duplicate);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();
    finish?.();
    await expect(first).resolves.toBe("complete");
  });
});

describe("analysis progress presentation", () => {
  it.each([
    ["UPLOADED", "Preparing analysis"],
    ["TRANSCRIBING", "Transcribing lecture"],
    ["EXTRACTING_PDF", "Reading PDF"],
    ["EXTRACTING_TOPICS", "Extracting topics"],
    ["COMPARING", "Comparing lecture and PDF"],
    ["COMPLETED", "Analysis complete"],
    ["FAILED", "Analysis failed"],
  ])("maps %s to a friendly label", (status, label) => {
    expect(getAnalysisStatusLabel(status)).toBe(label);
  });

  it("stops polling for completed and failed analyses", () => {
    expect(shouldPollAnalysis("COMPLETED")).toBe(false);
    expect(shouldPollAnalysis("FAILED")).toBe(false);
    expect(shouldPollAnalysis("COMPARING")).toBe(true);
  });
});
