import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAnalysisPipeline: vi.fn(),
}));

vi.mock("@/lib/analysis-pipeline/workflow", () => ({
  AnalysisPipelineError: class AnalysisPipelineError extends Error {},
  runAnalysisPipeline: mocks.runAnalysisPipeline,
}));

import { POST } from "@/app/api/analyses/[id]/run/route";

describe("POST /api/analyses/[id]/run", () => {
  beforeEach(() => {
    mocks.runAnalysisPipeline.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects malformed analysis IDs before running the pipeline", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "../../private" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.runAnalysisPipeline).not.toHaveBeenCalled();
  });

  it("never returns raw internal errors to the browser", async () => {
    mocks.runAnalysisPipeline.mockRejectedValue(
      new Error("Gemini key=secret at C:\\private\\model"),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "analysis-1" }),
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "ANALYSIS_PIPELINE_FAILED",
        message:
          "We couldn't complete the analysis. You can retry from where it stopped.",
      },
    });
    expect(serialized).not.toContain("Gemini");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private");
  });
});
