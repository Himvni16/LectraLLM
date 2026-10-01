import { afterEach, describe, expect, it } from "vitest";

import { getAiServiceUrl, requireServerEnv, validateServerEnv } from "@/lib/env";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAiServiceUrl = process.env.AI_SERVICE_URL;

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
});
