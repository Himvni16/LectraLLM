import { AnalysisStatus, TopicSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSingleFlightRunner } from "@/lib/analysis-pipeline/concurrency";
import {
  getAnalysisStatusLabel,
  shouldPollAnalysis,
} from "@/lib/analysis-pipeline/presentation";
import type { AnalysisResumeSnapshot } from "@/lib/analysis-pipeline/resume";
import {
  executeAnalysisPipeline,
  type AnalysisPipelineDependencies,
} from "@/lib/analysis-pipeline/workflow";

function snapshot(
  status: AnalysisStatus,
  overrides: Partial<AnalysisResumeSnapshot> = {},
): AnalysisResumeSnapshot {
  return {
    id: "analysis-1",
    status,
    transcriptText: null,
    pdfText: null,
    topics: [],
    ...overrides,
  };
}

function dependencies(
  analysis: AnalysisResumeSnapshot,
): AnalysisPipelineDependencies & {
  transcribe: ReturnType<typeof vi.fn>;
  extractPdf: ReturnType<typeof vi.fn>;
  extractTopics: ReturnType<typeof vi.fn>;
  compareTopics: ReturnType<typeof vi.fn>;
} {
  return {
    repository: {
      findById: vi.fn(async () => analysis),
      releaseInterruptedTranscription: vi.fn(async () => true),
    },
    transcribe: vi.fn(async () => undefined),
    extractPdf: vi.fn(async () => undefined),
    extractTopics: vi.fn(async () => undefined),
    compareTopics: vi.fn(async () => undefined),
  };
}

describe("analysis pipeline orchestration", () => {
  it("runs every existing workflow in order for an uploaded analysis", async () => {
    const calls: string[] = [];
    const deps = dependencies(snapshot(AnalysisStatus.UPLOADED));
    deps.transcribe.mockImplementation(async () => void calls.push("transcribe"));
    deps.extractPdf.mockImplementation(async () => void calls.push("pdf"));
    deps.extractTopics.mockImplementation(async () => void calls.push("topics"));
    deps.compareTopics.mockImplementation(async () => void calls.push("compare"));

    await expect(executeAnalysisPipeline("analysis-1", deps)).resolves.toEqual({
      analysisId: "analysis-1",
      status: AnalysisStatus.COMPLETED,
    });
    expect(calls).toEqual(["transcribe", "pdf", "topics", "compare"]);
  });

  it("preserves a transcript and resumes failed work at PDF extraction", async () => {
    const deps = dependencies(
      snapshot(AnalysisStatus.FAILED, { transcriptText: "Transcript" }),
    );

    await executeAnalysisPipeline("analysis-1", deps);

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.extractPdf).toHaveBeenCalledOnce();
    expect(deps.extractTopics).toHaveBeenCalledOnce();
    expect(deps.compareTopics).toHaveBeenCalledOnce();
  });

  it("preserves transcript and PDF text and resumes at topic extraction", async () => {
    const deps = dependencies(
      snapshot(AnalysisStatus.FAILED, {
        transcriptText: "Transcript",
        pdfText: "PDF text",
      }),
    );

    await executeAnalysisPipeline("analysis-1", deps);

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.extractPdf).not.toHaveBeenCalled();
    expect(deps.extractTopics).toHaveBeenCalledOnce();
    expect(deps.compareTopics).toHaveBeenCalledOnce();
  });

  it("preserves extracted topics and resumes at comparison", async () => {
    const deps = dependencies(
      snapshot(AnalysisStatus.FAILED, {
        transcriptText: "Transcript",
        pdfText: "PDF text",
        topics: [
          { source: TopicSource.VIDEO },
          { source: TopicSource.PDF },
        ],
      }),
    );

    await executeAnalysisPipeline("analysis-1", deps);

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.extractPdf).not.toHaveBeenCalled();
    expect(deps.extractTopics).not.toHaveBeenCalled();
    expect(deps.compareTopics).toHaveBeenCalledOnce();
  });

  it("does no work for an already completed analysis", async () => {
    const deps = dependencies(snapshot(AnalysisStatus.COMPLETED));

    await executeAnalysisPipeline("analysis-1", deps);

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.extractPdf).not.toHaveBeenCalled();
    expect(deps.extractTopics).not.toHaveBeenCalled();
    expect(deps.compareTopics).not.toHaveBeenCalled();
  });

  it("releases an interrupted transcription into the existing retry path", async () => {
    const deps = dependencies(snapshot(AnalysisStatus.TRANSCRIBING));

    await executeAnalysisPipeline("analysis-1", deps);

    expect(deps.repository.releaseInterruptedTranscription).toHaveBeenCalledWith(
      "analysis-1",
    );
    expect(deps.transcribe).toHaveBeenCalledOnce();
  });

  it("stops immediately and never invokes later stages after a failure", async () => {
    const deps = dependencies(snapshot(AnalysisStatus.UPLOADED));
    deps.extractPdf.mockRejectedValue(new Error("private service failure"));

    await expect(
      executeAnalysisPipeline("analysis-1", deps),
    ).rejects.toThrow("private service failure");
    expect(deps.transcribe).toHaveBeenCalledOnce();
    expect(deps.extractPdf).toHaveBeenCalledOnce();
    expect(deps.extractTopics).not.toHaveBeenCalled();
    expect(deps.compareTopics).not.toHaveBeenCalled();
  });

  it("shares duplicate in-flight requests instead of running model work twice", async () => {
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
