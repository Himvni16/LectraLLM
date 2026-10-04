import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("upload UI contract", () => {
  it("keeps the existing file pickers, action label, and redirect", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "components", "upload-form.tsx"),
      "utf8",
    );

    expect(source).toContain('label="Lecture video"');
    expect(source).toContain('label="Corresponding PDF"');
    expect(source).toContain('"Upload & Analyze"');
    expect(source).toContain("router.push(`/analyses/${encodeURIComponent(result.analysisId)}`)");
    expect(source).toContain('fetch("/api/uploads/initiate"');
    expect(source).toContain("uploadVideoToCloudinary");
    expect(source).toContain("uploadPdfToSupabase");
    expect(source).toContain("up to ${limits.videoMaxSizeMb} MB");
  });
});
