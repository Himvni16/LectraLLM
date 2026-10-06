import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("analysis staged polling contract", () => {
  it("runs one request at a time and repeatedly triggers /run from persisted status", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "transcription-panel.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "`/api/analyses/${encodeURIComponent(initialAnalysis.id)}/run`",
    );
    expect(source).toContain("if (requestInFlight.current) return null");
    expect(source).toContain("const nextAnalysis = await startPipeline()");
    expect(source).toContain("timer = setTimeout(poll, 5000)");
    expect(source).toContain(
      "if (!shouldPollAnalysis(analysis.status)) return",
    );
    expect(source).toContain('const failed = analysis.status === "FAILED"');
    expect(source).toContain('{failed ? (');
    expect(source).toContain('"Retry Analysis"');
  });
});
