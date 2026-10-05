import type { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyNextMigration,
  calculateMigrationChecksum,
  classifyMigrations,
  formatSafeMigrationError,
  readMigrationFiles,
  readMigrationStatus,
  reportTopLevelError,
  transactionSafetyIssue,
  validateMigrationTableColumns,
  type MigrationFile,
  type MigrationHistoryRow,
  type MigrationTableColumn,
} from "../scripts/migrate-pg";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

const migration: MigrationFile = {
  name: "20261005141000_add_transcription_provider_file",
  sql: 'ALTER TABLE "Analysis" ADD COLUMN "providerFile" TEXT;',
  checksum: "checksum-1",
};

function history(
  overrides: Partial<MigrationHistoryRow> = {},
): MigrationHistoryRow {
  return {
    id: "6d10eaeb-3f4a-48d9-b627-ecf65d01a740",
    checksum: migration.checksum,
    finished_at: new Date("2026-10-05T10:00:01.000Z"),
    migration_name: migration.name,
    has_logs: false,
    rolled_back_at: null,
    started_at: new Date("2026-10-05T10:00:00.000Z"),
    applied_steps_count: 1,
    ...overrides,
  };
}

function migrationColumns(): MigrationTableColumn[] {
  return [
    ["id", "character varying", 36, "NO", null],
    ["checksum", "character varying", 64, "NO", null],
    ["finished_at", "timestamp with time zone", null, "YES", null],
    ["migration_name", "character varying", 255, "NO", null],
    ["logs", "text", null, "YES", null],
    ["rolled_back_at", "timestamp with time zone", null, "YES", null],
    ["started_at", "timestamp with time zone", null, "NO", "now()"],
    ["applied_steps_count", "integer", null, "NO", "0"],
  ].map(
    ([column_name, data_type, character_maximum_length, is_nullable, column_default]) => ({
      column_name: column_name as string,
      data_type: data_type as string,
      character_maximum_length: character_maximum_length as number | null,
      is_nullable: is_nullable as "YES" | "NO",
      column_default: column_default as string | null,
    }),
  );
}

describe("pg migration discovery and Prisma bookkeeping", () => {
  it("uses raw-file SHA-256 checksums compatible with existing Prisma history", () => {
    expect(
      calculateMigrationChecksum(new TextEncoder().encode("hello\n")),
    ).toBe("5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
  });

  it("loads migration folders in lexical order with verified checksums", async () => {
    const migrations = await readMigrationFiles();

    expect(migrations.map((entry) => entry.name)).toEqual([
      "20261001194500_phase_1_minimal_data_structure",
      "20261002150000_phase_6_nullable_missing_video_topic",
      "20261005031500_add_analysis_processing_lease",
      "20261005141000_add_transcription_provider_file",
    ]);
    expect(migrations[0]?.checksum).toBe(
      "ea56b537610c60a303ef3fe4a0c79d67480c398be1acfb310c2c0eea177daf0a",
    );
  });

  it("validates the inspected Prisma 6 migration table shape", () => {
    expect(() => validateMigrationTableColumns(migrationColumns())).not.toThrow();
    expect(() =>
      validateMigrationTableColumns(migrationColumns().slice(1)),
    ).toThrow("does not have the Prisma 6 migration-history shape");
  });

  it("classifies successful, pending, failed, rolled-back, and database-only rows", () => {
    const second = { ...migration, name: "20261006000000_second" };
    const third = { ...migration, name: "20261007000000_third" };
    const status = classifyMigrations([migration, second, third], [
      history(),
      history({
        id: "failed-id",
        migration_name: second.name,
        finished_at: null,
        has_logs: true,
        applied_steps_count: 0,
      }),
      history({
        id: "rolled-back-id",
        migration_name: third.name,
        finished_at: null,
        rolled_back_at: new Date("2026-10-05T11:00:00.000Z"),
        applied_steps_count: 0,
      }),
      history({
        id: "database-only-id",
        migration_name: "20260901000000_database_only",
      }),
    ]);

    expect(status.applied.map((entry) => entry.name)).toEqual([migration.name]);
    expect(status.pending.map((entry) => entry.name)).toEqual([third.name]);
    expect(status.failed.map((entry) => entry.name)).toEqual([second.name]);
    expect(status.databaseOnly).toEqual(["20260901000000_database_only"]);
  });

  it("reports checksum drift instead of silently skipping it", () => {
    const status = classifyMigrations(
      [migration],
      [history({ checksum: "different-checksum" })],
    );

    expect(status.checksumMismatches).toEqual([
      {
        name: migration.name,
        localChecksum: migration.checksum,
        storedChecksum: "different-checksum",
      },
    ]);
  });
});

describe("transactional pg migration application", () => {
  it("rejects migrations that cannot safely be transaction-wrapped", () => {
    expect(transactionSafetyIssue("CREATE INDEX CONCURRENTLY x ON y (id);")).toBe(
      "concurrent index operation",
    );
    expect(transactionSafetyIssue("BEGIN; SELECT 1; COMMIT;")).toBe(
      "explicit transaction control",
    );
    expect(
      transactionSafetyIssue("-- VACUUM is mentioned here\nALTER TABLE x ADD y text;"),
    ).toBeNull();
  });

  it("records a successful migration atomically with Prisma-compatible fields", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void sql;
      void values;
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as Client;

    await expect(
      applyNextMigration(client, [migration], "postgresql://secret"),
    ).resolves.toEqual(migration);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SET LOCAL lock_timeout"),
      "SELECT pg_advisory_xact_lock(72707369)",
      expect.stringContaining("information_schema.columns"),
      expect.stringContaining('FROM "_prisma_migrations"'),
      expect.stringContaining('INSERT INTO "_prisma_migrations"'),
      migration.sql,
      expect.stringContaining('UPDATE "_prisma_migrations"'),
      "COMMIT",
    ]);
    expect(query.mock.calls[5]?.[1]).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      migration.checksum,
      migration.name,
      expect.any(Date),
    ]);
  });

  it("re-checks migration history after taking a transaction-scoped lock", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      return { rows: [] };
    });

    await applyNextMigration(
      { query } as unknown as Client,
      [migration],
      "postgresql://secret",
    );

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.indexOf("SELECT pg_advisory_xact_lock(72707369)"))
      .toBeLessThan(
        statements.findIndex((sql) =>
          sql.includes('FROM "_prisma_migrations"'),
        ),
      );
  });

  it("refuses checksum drift after locking and does not execute migration SQL", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      if (sql.includes('FROM "_prisma_migrations"')) {
        return { rows: [history({ checksum: "different-checksum" })] };
      }
      return { rows: [] };
    });

    await expect(
      applyNextMigration(
        { query } as unknown as Client,
        [migration],
        "postgresql://secret",
      ),
    ).rejects.toThrow("Migration checksums differ from Prisma history");

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain(migration.sql);
    expect(statements.join("\n")).not.toContain(
      'INSERT INTO "_prisma_migrations"',
    );
  });

  it("refuses transaction-incompatible SQL before writing migration history", async () => {
    const incompatible = {
      ...migration,
      sql: "CREATE INDEX CONCURRENTLY x ON y (id);",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      return { rows: [] };
    });

    await expect(
      applyNextMigration(
        { query } as unknown as Client,
        [incompatible],
        "postgresql://secret",
      ),
    ).rejects.toThrow("unsupported concurrent index operation");

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain(incompatible.sql);
    expect(statements.join("\n")).not.toContain(
      'INSERT INTO "_prisma_migrations"',
    );
  });

  it("reads status without acquiring any advisory lock", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      return { rows: [] };
    });

    const status = await readMigrationStatus(
      { query } as unknown as Client,
      [migration],
    );

    expect(status.pending).toEqual([migration]);
    expect(query.mock.calls.map(([sql]) => sql).join("\n"))
      .not.toContain("pg_advisory");
  });

  it("serializes concurrent runners so a migration is applied only once", async () => {
    const sharedHistory: MigrationHistoryRow[] = [];
    let migrationExecutions = 0;
    let lockTail = Promise.resolve();

    function createClient(): Client {
      let releaseLock: (() => void) | undefined;
      let transactionRow: MigrationHistoryRow | undefined;
      const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "SELECT pg_advisory_xact_lock(72707369)") {
          let releaseCurrent!: () => void;
          const current = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
          });
          const previous = lockTail;
          lockTail = previous.then(() => current);
          await previous;
          releaseLock = releaseCurrent;
          return { rows: [] };
        }
        if (sql.includes("information_schema.columns")) {
          return { rows: migrationColumns() };
        }
        if (sql.includes('FROM "_prisma_migrations"')) {
          return { rows: [...sharedHistory] };
        }
        if (sql.includes('INSERT INTO "_prisma_migrations"')) {
          transactionRow = history({
            id: values?.[0] as string,
            checksum: values?.[1] as string,
            migration_name: values?.[2] as string,
            finished_at: null,
            started_at: values?.[3] as Date,
            applied_steps_count: 0,
          });
          return { rows: [] };
        }
        if (sql === migration.sql) {
          migrationExecutions += 1;
          return { rows: [] };
        }
        if (sql.includes('UPDATE "_prisma_migrations"')) {
          if (transactionRow) {
            transactionRow.finished_at = new Date();
            transactionRow.applied_steps_count = 1;
          }
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (sql === "COMMIT" && transactionRow) {
            sharedHistory.push(transactionRow);
          }
          transactionRow = undefined;
          releaseLock?.();
          releaseLock = undefined;
          return { rows: [] };
        }
        return { rows: [] };
      });
      return { query } as unknown as Client;
    }

    const results = await Promise.all([
      applyNextMigration(createClient(), [migration], "postgresql://secret"),
      applyNextMigration(createClient(), [migration], "postgresql://secret"),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(migrationExecutions).toBe(1);
    expect(sharedHistory).toHaveLength(1);
    expect(sharedHistory[0]?.finished_at).toBeInstanceOf(Date);
  });

  it("rolls SQL back and records an unresolved failed migration", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      if (sql === migration.sql) {
        const error = new Error("column already exists at postgresql://secret") as
          Error & { code: string; severity: string };
        error.code = "42701";
        error.severity = "ERROR";
        throw error;
      }
      return { rows: [] };
    });
    const client = { query } as unknown as Client;

    await expect(
      applyNextMigration(client, [migration], "postgresql://secret"),
    ).rejects.toThrow(`${migration.name} failed and was rolled back`);

    const calls = query.mock.calls;
    expect(calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SET LOCAL lock_timeout"),
      "SELECT pg_advisory_xact_lock(72707369)",
      expect.stringContaining("information_schema.columns"),
      expect.stringContaining('FROM "_prisma_migrations"'),
      expect.stringContaining('INSERT INTO "_prisma_migrations"'),
      migration.sql,
      "ROLLBACK",
      "BEGIN",
      expect.stringContaining("SET LOCAL lock_timeout"),
      "SELECT pg_advisory_xact_lock(72707369)",
      expect.stringContaining("information_schema.columns"),
      expect.stringContaining('FROM "_prisma_migrations"'),
      expect.stringContaining('INSERT INTO "_prisma_migrations"'),
      "COMMIT",
    ]);
    const failureInsert = calls.at(-2);
    expect(failureInsert?.[1]?.[3]).toContain("Code: 42701");
    expect(failureInsert?.[1]?.[3]).toContain("[REDACTED]");
    expect(failureInsert?.[1]?.[3]).not.toContain("postgresql://secret");
  });

  it("never uses a session-level advisory lock", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: migrationColumns() };
      }
      return { rows: [] };
    });

    await applyNextMigration(
      { query } as unknown as Client,
      [migration],
      "postgresql://secret",
    );

    const statements = query.mock.calls.map(([sql]) => sql).join("\n");
    expect(statements).toContain("pg_advisory_xact_lock");
    expect(statements).not.toMatch(/pg_advisory_lock\s*\(/);
    expect(statements).not.toContain("pg_advisory_unlock");
  });
});

describe("migration command error reporting", () => {
  it("extracts safe PostgreSQL fields from a nested AggregateError", () => {
    const postgresError = Object.assign(
      new Error('password authentication failed for user "postgres"'),
      {
        code: "28P01",
        severity: "FATAL",
        routine: "auth_failed",
      },
    );

    expect(formatSafeMigrationError(new AggregateError([postgresError], "")))
      .toBe(`Migration command failed.
Severity: FATAL
Code: 28P01
Message: password authentication failed for user "postgres"
Routine: auth_failed`);
  });

  it("redacts configured URLs, embedded PostgreSQL URLs, and passwords", () => {
    const directUrl =
      "postgresql://postgres:direct-secret@session-pooler.test:5432/postgres";
    const databaseUrl =
      "postgresql://postgres:runtime-secret@transaction-pooler.test:6543/postgres";
    const error = Object.assign(
      new Error(
        `Failed ${directUrl}; fallback ${databaseUrl}; password=plain-secret`,
      ),
      { code: "CONNECTION_FAILED" },
    );

    const output = formatSafeMigrationError(error, {
      DIRECT_URL: directUrl,
      DATABASE_URL: databaseUrl,
      PGPASSWORD: "plain-secret",
    });

    expect(output).not.toContain(directUrl);
    expect(output).not.toContain(databaseUrl);
    expect(output).not.toContain("direct-secret");
    expect(output).not.toContain("runtime-secret");
    expect(output).not.toContain("plain-secret");
    expect(output).toContain("[REDACTED]");
  });

  it("always writes a visible fallback and preserves exit code 1", () => {
    const write = vi.fn();

    reportTopLevelError(new AggregateError([], ""), write);

    expect(write).toHaveBeenCalledWith(
      "Migration command failed.\nMessage: Unknown migration failure.\n",
    );
    expect(process.exitCode).toBe(1);
  });
});
