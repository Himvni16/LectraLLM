import { describe, expect, it, vi } from "vitest";

import {
  createPostgresConnectionConfig,
  isSupabaseTransactionPooler,
} from "@/lib/postgres-config";

describe("PostgreSQL connection configuration", () => {
  it("uses explicit TLS without CA verification for Supabase transaction pooling", () => {
    const config = createPostgresConnectionConfig(
      "postgresql://postgres.project-ref:secret@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require&sslrootcert=certificate.pem",
    );

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    const normalized = new URL(config.connectionString as string);
    expect(normalized.searchParams.get("pgbouncer")).toBe("true");
    expect(normalized.searchParams.has("sslmode")).toBe(false);
    expect(normalized.searchParams.has("sslrootcert")).toBe(false);
    expect(normalized.username).toBe("postgres.project-ref");
    expect(normalized.password).toBe("secret");
  });

  it("does not weaken certificate verification for unrelated PostgreSQL endpoints", () => {
    const neonUrl =
      "postgresql://runtime:secret@pooler.example.test:5432/postgres?sslmode=verify-full";
    const config = createPostgresConnectionConfig(neonUrl);

    expect(isSupabaseTransactionPooler(neonUrl)).toBe(false);
    expect(config).toEqual({ connectionString: neonUrl });
    expect(config).not.toHaveProperty("ssl");
  });

  it("does not log connection credentials while building pg configuration", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    createPostgresConnectionConfig(
      "postgresql://postgres.project-ref:never-log-this@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    );

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
