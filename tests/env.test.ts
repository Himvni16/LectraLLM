import { afterEach, describe, expect, it } from "vitest";

import {
  getAiServiceUrl,
  getUploadLimits,
  requireServerEnv,
  validateServerEnv,
} from "@/lib/env";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAiServiceUrl = process.env.AI_SERVICE_URL;
const originalVideoMaxSize = process.env.VIDEO_MAX_SIZE_MB;
const originalPdfMaxSize = process.env.PDF_MAX_SIZE_MB;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalAiServiceUrl === undefined) {
    delete process.env.AI_SERVICE_URL;
  } else {
    process.env.AI_SERVICE_URL = originalAiServiceUrl;
  }

  if (originalVideoMaxSize === undefined) {
    delete process.env.VIDEO_MAX_SIZE_MB;
  } else {
    process.env.VIDEO_MAX_SIZE_MB = originalVideoMaxSize;
  }

  if (originalPdfMaxSize === undefined) {
    delete process.env.PDF_MAX_SIZE_MB;
  } else {
    process.env.PDF_MAX_SIZE_MB = originalPdfMaxSize;
  }
});

describe("server environment validation", () => {
  it("returns a configured value", () => {
    process.env.DATABASE_URL = "postgresql://localhost/lectrallm";

    expect(requireServerEnv("DATABASE_URL")).toBe(
      "postgresql://localhost/lectrallm",
    );
  });

  it("fails with a useful message when a required value is absent", () => {
    delete process.env.DATABASE_URL;

    expect(() => requireServerEnv("DATABASE_URL")).toThrow(
      "Missing required environment variable: DATABASE_URL",
    );
  });

  it("normalizes the configured AI service URL", () => {
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000/";

    expect(getAiServiceUrl()).toBe("http://127.0.0.1:8000");
  });

  it("validates all required server configuration", () => {
    process.env.DATABASE_URL = "postgresql://localhost/lectrallm";
    process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";

    expect(() => validateServerEnv()).not.toThrow();
  });

  it("provides configurable upload size limits", () => {
    process.env.VIDEO_MAX_SIZE_MB = "300";
    process.env.PDF_MAX_SIZE_MB = "30";

    expect(getUploadLimits()).toEqual({
      videoMaxSizeMb: 300,
      pdfMaxSizeMb: 30,
      videoMaxSizeBytes: 300 * 1024 * 1024,
      pdfMaxSizeBytes: 30 * 1024 * 1024,
    });
  });
});
