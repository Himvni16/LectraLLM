import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Client, ClientConfig } from "pg";

import { createPostgresConnectionConfig } from "../src/lib/postgres-config";

const PRISMA_MIGRATION_LOCK_ID = 72_707_369;
const MIGRATION_LOCK_TIMEOUT_MS = 10_000;
const TRANSACTION_LOCK_SQL = `SELECT pg_advisory_xact_lock(${PRISMA_MIGRATION_LOCK_ID})`;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationHistoryRow {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  has_logs: boolean;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

export interface MigrationStatus {
  applied: MigrationFile[];
  pending: MigrationFile[];
  failed: Array<{
    name: string;
    checksum: string;
    startedAt: Date;
    hasLogs: boolean;
  }>;
  checksumMismatches: Array<{
    name: string;
    localChecksum: string;
    storedChecksum: string;
  }>;
  databaseOnly: string[];
}

export interface MigrationTableColumn {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface SafeErrorFields {
  code?: string;
  message?: string;
  severity?: string;
  routine?: string;
}

interface RedactionEnvironment {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  PGPASSWORD?: string;
}

const EXPECTED_MIGRATION_COLUMNS = [
  ["id", "character varying", 36, "NO"],
  ["checksum", "character varying", 64, "NO"],
  ["finished_at", "timestamp with time zone", null, "YES"],
  ["migration_name", "character varying", 255, "NO"],
  ["logs", "text", null, "YES"],
  ["rolled_back_at", "timestamp with time zone", null, "YES"],
  ["started_at", "timestamp with time zone", null, "NO"],
  ["applied_steps_count", "integer", null, "NO"],
] as const;

export function calculateMigrationChecksum(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function readMigrationFiles(
  migrationsRoot = path.join(process.cwd(), "prisma", "migrations"),
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const migrations: MigrationFile[] = [];
  for (const name of migrationNames) {
    const migrationPath = path.join(migrationsRoot, name, "migration.sql");
    let contents: Buffer;
    try {
      contents = await readFile(migrationPath);
    } catch (error) {
      throw new Error(`Migration ${name} has no readable migration.sql.`, {
        cause: error,
      });
    }
    migrations.push({
      name,
      sql: contents.toString("utf8"),
      checksum: calculateMigrationChecksum(contents),
    });
  }

  return migrations;
}

export function validateMigrationTableColumns(
  columns: MigrationTableColumn[],
): void {
  if (columns.length !== EXPECTED_MIGRATION_COLUMNS.length) {
    throw new Error(
      "_prisma_migrations does not have the Prisma 6 migration-history shape.",
    );
  }

  for (const [name, dataType, maximumLength, nullable] of
    EXPECTED_MIGRATION_COLUMNS) {
    const column = columns.find((candidate) => candidate.column_name === name);
    if (
      !column ||
      column.data_type !== dataType ||
      column.character_maximum_length !== maximumLength ||
      column.is_nullable !== nullable
    ) {
      throw new Error(
        `_prisma_migrations column ${name} is incompatible with Prisma 6.12.0.`,
      );
    }
  }

  const startedAt = columns.find(
    (column) => column.column_name === "started_at",
  );
  const appliedSteps = columns.find(
    (column) => column.column_name === "applied_steps_count",
  );
  if (!startedAt?.column_default || appliedSteps?.column_default !== "0") {
    throw new Error(
      "_prisma_migrations defaults are incompatible with Prisma 6.12.0.",
    );
  }
}

export function classifyMigrations(
  migrations: MigrationFile[],
  history: MigrationHistoryRow[],
): MigrationStatus {
  const applied: MigrationFile[] = [];
  const pending: MigrationFile[] = [];
  const failed: MigrationStatus["failed"] = [];
  const checksumMismatches: MigrationStatus["checksumMismatches"] = [];
  const migrationNames = new Set(migrations.map((migration) => migration.name));

  for (const row of history) {
    if (row.rolled_back_at !== null || row.finished_at !== null) continue;
    failed.push({
      name: row.migration_name,
      checksum: row.checksum,
      startedAt: row.started_at,
      hasLogs: row.has_logs,
    });
  }

  for (const migration of migrations) {
    const activeRows = history.filter(
      (row) =>
        row.migration_name === migration.name && row.rolled_back_at === null,
    );
    const successfulRows = activeRows.filter(
      (row) => row.finished_at !== null,
    );

    if (successfulRows.length > 1) {
      throw new Error(
        `Migration ${migration.name} has multiple successful history rows.`,
      );
    }

    const activeRow = successfulRows[0] ?? activeRows[0];
    if (activeRow && activeRow.checksum !== migration.checksum) {
      checksumMismatches.push({
        name: migration.name,
        localChecksum: migration.checksum,
        storedChecksum: activeRow.checksum,
      });
    }

    if (successfulRows.length === 1) {
      applied.push(migration);
    } else if (!activeRows.some((row) => row.finished_at === null)) {
      pending.push(migration);
    }
  }

  const databaseOnly = [
    ...new Set(
      history
        .filter(
          (row) =>
            row.finished_at !== null &&
            row.rolled_back_at === null &&
            !migrationNames.has(row.migration_name),
        )
        .map((row) => row.migration_name),
    ),
  ].sort();

  return {
    applied,
    pending,
    failed,
    checksumMismatches,
    databaseOnly,
  };
}

function sqlWithoutComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
}

export function transactionSafetyIssue(sql: string): string | null {
  const inspected = sqlWithoutComments(sql);
  const unsupported: Array<[RegExp, string]> = [
    [
      /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i,
      "explicit transaction control",
    ],
    [/\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i, "concurrent index operation"],
    [/\bREINDEX\b[\s\S]*?\bCONCURRENTLY\b/i, "concurrent reindex"],
    [/\bREFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\b/i, "concurrent materialized-view refresh"],
    [/\bVACUUM\b/i, "VACUUM"],
    [/\b(?:CREATE|DROP)\s+DATABASE\b/i, "database creation or removal"],
    [/\bALTER\s+SYSTEM\b/i, "ALTER SYSTEM"],
    [/\bCREATE\s+EXTENSION\b/i, "extension installation"],
    [/\bALTER\s+TYPE\b[\s\S]*?\bADD\s+VALUE\b/i, "enum value addition"],
    [/\bCALL\s+[A-Za-z_"]/i, "procedure call"],
  ];

  return unsupported.find(([pattern]) => pattern.test(inspected))?.[1] ?? null;
}

async function inspectMigrationTable(client: Client): Promise<void> {
  const result = await client.query<MigrationTableColumn>(
    `SELECT column_name,
            data_type,
            character_maximum_length,
            is_nullable,
            column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '_prisma_migrations'
      ORDER BY ordinal_position`,
  );
  validateMigrationTableColumns(result.rows);
}

async function readMigrationHistory(
  client: Client,
): Promise<MigrationHistoryRow[]> {
  const result = await client.query<MigrationHistoryRow>(
    `SELECT id,
            checksum,
            finished_at,
            migration_name,
            logs IS NOT NULL AS has_logs,
            rolled_back_at,
            started_at,
            applied_steps_count
       FROM "_prisma_migrations"
      ORDER BY started_at, migration_name`,
  );
  return result.rows;
}

function errorLog(error: unknown, connectionString: string): string {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    severity?: unknown;
  };
  const values = [
    typeof candidate.severity === "string"
      ? `Severity: ${candidate.severity}`
      : null,
    typeof candidate.code === "string" ? `Code: ${candidate.code}` : null,
    `Message: ${
      typeof candidate.message === "string"
        ? candidate.message
        : "Unknown migration error."
    }`,
  ].filter((value): value is string => value !== null);
  return values.join("\n").replaceAll(connectionString, "[REDACTED]");
}

function errorChildren(error: unknown): unknown[] {
  if (typeof error !== "object" || error === null) return [];
  const candidate = error as { cause?: unknown; errors?: unknown };
  const children = Array.isArray(candidate.errors) ? [...candidate.errors] : [];
  if (candidate.cause !== undefined) children.push(candidate.cause);
  return children;
}

function errorFields(error: unknown): SafeErrorFields {
  if (typeof error !== "object" || error === null) {
    return typeof error === "string" && error.trim()
      ? { message: error.trim() }
      : {};
  }
  const candidate = error as Record<string, unknown>;
  const field = (name: string) => {
    const value = candidate[name];
    return typeof value === "string" && value.trim()
      ? value.trim()
      : undefined;
  };
  return {
    severity: field("severity"),
    code: field("code"),
    message: field("message"),
    routine: field("routine"),
  };
}

function redactSecrets(
  value: string,
  environment: RedactionEnvironment,
): string {
  let redacted = value;
  const connectionStrings = [
    environment.DIRECT_URL,
    environment.DATABASE_URL,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const secrets = new Set<string>(
    [environment.PGPASSWORD, ...connectionStrings]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => candidate.trim())
      .filter(Boolean),
  );

  for (const connectionString of connectionStrings) {
    try {
      const parsed = new URL(connectionString);
      if (parsed.password) {
        secrets.add(parsed.password);
        try {
          secrets.add(decodeURIComponent(parsed.password));
        } catch {
          // The encoded password is still redacted.
        }
      }
    } catch {
      // The complete configured value is still redacted below.
    }
  }

  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }

  return redacted
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_CONNECTION_STRING]")
    .replace(/\b(password\s*[=:]\s*)[^\s;]+/gi, "$1[REDACTED]");
}

export function formatSafeMigrationError(
  error: unknown,
  environment: RedactionEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    PGPASSWORD: process.env.PGPASSWORD,
  },
): string {
  const queue = [error];
  const seen = new Set<unknown>();
  let selected: SafeErrorFields | undefined;
  let selectedScore = 0;

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const fields = errorFields(candidate);
    const score =
      (fields.message ? 4 : 0) +
      (fields.code ? 2 : 0) +
      (fields.severity ? 1 : 0) +
      (fields.routine ? 1 : 0);
    if (score > selectedScore) {
      selected = fields;
      selectedScore = score;
    }
    queue.push(...errorChildren(candidate));
  }

  const lines = ["Migration command failed."];
  if (selected?.severity) lines.push(`Severity: ${selected.severity}`);
  if (selected?.code) lines.push(`Code: ${selected.code}`);
  lines.push(`Message: ${selected?.message ?? "Unknown migration failure."}`);
  if (selected?.routine) lines.push(`Routine: ${selected.routine}`);
  return redactSecrets(lines.join("\n"), environment);
}

export function reportTopLevelError(
  error: unknown,
  write: (message: string) => void = (message) => process.stderr.write(message),
): void {
  try {
    write(`${formatSafeMigrationError(error)}\n`);
  } catch {
    process.stderr.write("Migration command failed.\n");
  }
  process.exitCode = 1;
}

export async function readMigrationStatus(
  client: Client,
  migrations: MigrationFile[],
): Promise<MigrationStatus> {
  await inspectMigrationTable(client);
  const history = await readMigrationHistory(client);
  return classifyMigrations(migrations, history);
}

async function rollbackTransaction(client: Client): Promise<unknown> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error;
  }
}

async function recordFailedMigration(
  client: Client,
  migration: MigrationFile,
  connectionString: string,
  id: string,
  startedAt: Date,
  migrationError: unknown,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT_MS}ms'`);
    await client.query(TRANSACTION_LOCK_SQL);
    await inspectMigrationTable(client);
    const history = await readMigrationHistory(client);
    const activeAttemptExists = history.some(
      (row) =>
        row.migration_name === migration.name && row.rolled_back_at === null,
    );

    if (!activeAttemptExists) {
      await client.query(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, logs,
            rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, NULL, $3, $4, NULL, $5, 0)`,
        [
          id,
          migration.checksum,
          migration.name,
          errorLog(migrationError, connectionString),
          startedAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    const rollbackError = await rollbackTransaction(client);
    throw new AggregateError(
      [error, rollbackError].filter((candidate) => candidate !== undefined),
      `The failure record for migration ${migration.name} could not be written.`,
    );
  }
}

export async function applyNextMigration(
  client: Client,
  migrations: MigrationFile[],
  connectionString: string,
): Promise<MigrationFile | null> {
  await client.query("BEGIN");

  let migration: MigrationFile | undefined;
  let id: string | undefined;
  let startedAt: Date | undefined;
  let migrationStarted = false;
  try {
    await client.query(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT_MS}ms'`);
    await client.query(TRANSACTION_LOCK_SQL);
    const status = await readMigrationStatus(client, migrations);
    assertApplyAllowed(status);
    migration = status.pending[0];
    if (!migration) {
      await client.query("COMMIT");
      return null;
    }

    const safetyIssue = transactionSafetyIssue(migration.sql);
    if (safetyIssue) {
      throw new Error(
        `Migration ${migration.name} requires unsupported ${safetyIssue}; it was not applied.`,
      );
    }

    id = randomUUID();
    startedAt = new Date();
    await client.query(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs,
          rolled_back_at, started_at, applied_steps_count)
      VALUES ($1, $2, NULL, $3, NULL, NULL, $4, 0)`,
      [id, migration.checksum, migration.name, startedAt],
    );
    migrationStarted = true;
    await client.query(migration.sql);
    await client.query(
      `UPDATE "_prisma_migrations"
          SET finished_at = now(), applied_steps_count = 1
        WHERE id = $1`,
      [id],
    );
    await client.query("COMMIT");
    return migration;
  } catch (error) {
    const rollbackError = await rollbackTransaction(client);

    if (
      rollbackError !== undefined ||
      !migrationStarted ||
      !migration ||
      !id ||
      !startedAt
    ) {
      if (rollbackError !== undefined) {
        throw new AggregateError(
          [error, rollbackError],
          `Migration ${migration?.name ?? "transaction"} failed and could not be rolled back.`,
        );
      }
      throw error;
    }

    try {
      await recordFailedMigration(
        client,
        migration,
        connectionString,
        id,
        startedAt,
        error,
      );
    } catch (historyError) {
      throw new AggregateError(
        [error, historyError],
        `Migration ${migration.name} failed and its failure could not be recorded.`,
      );
    }

    throw new Error(`Migration ${migration.name} failed and was rolled back.`, {
      cause: error,
    });
  }
}

function printGroup(title: string, names: string[]): void {
  console.log(`${title} (${names.length})`);
  if (names.length === 0) {
    console.log("  none");
    return;
  }
  for (const name of names) console.log(`  ${name}`);
}

export function printMigrationStatus(status: MigrationStatus): void {
  console.log("Migration status");
  printGroup(
    "Applied",
    status.applied.map((migration) => migration.name),
  );
  printGroup(
    "Pending",
    status.pending.map((migration) => migration.name),
  );
  printGroup(
    "Failed",
    status.failed.map((migration) => migration.name),
  );
  printGroup(
    "Checksum mismatches",
    status.checksumMismatches.map((migration) => migration.name),
  );
  printGroup("Database-only history", status.databaseOnly);
}

function assertApplyAllowed(status: MigrationStatus): void {
  if (status.failed.length > 0) {
    throw new Error(
      "Unresolved failed migrations exist. Resolve them before applying migrations.",
    );
  }
  if (status.checksumMismatches.length > 0) {
    throw new Error(
      "Migration checksums differ from Prisma history. No migrations were applied.",
    );
  }
}

async function run(command: "status" | "apply"): Promise<void> {
  const [nextEnvModule, pgModule] = await Promise.all([
    import("@next/env"),
    import("pg"),
  ]);
  const nextEnvCandidate = nextEnvModule as unknown as {
    default?: { loadEnvConfig?: (directory: string) => unknown };
    loadEnvConfig?: (directory: string) => unknown;
  };
  const loadEnvConfig =
    nextEnvCandidate.loadEnvConfig ?? nextEnvCandidate.default?.loadEnvConfig;
  if (!loadEnvConfig) {
    throw new Error("Next.js environment loading is unavailable.");
  }
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL migrations.");
  }

  const pgCandidate = pgModule as unknown as {
    Client?: new (options: ClientConfig) => Client;
    default?: {
      Client?: new (options: ClientConfig) => Client;
    };
  };
  const ClientConstructor = pgCandidate.Client ?? pgCandidate.default?.Client;
  if (!ClientConstructor) {
    throw new Error("The PostgreSQL driver is unavailable.");
  }
  const client = new ClientConstructor(
    createPostgresConnectionConfig(connectionString),
  );
  await client.connect();
  let operationError: unknown;
  try {
    const migrations = await readMigrationFiles();
    const status = await readMigrationStatus(client, migrations);
    printMigrationStatus(status);

    if (command === "status") return;
    assertApplyAllowed(status);

    let appliedCount = 0;
    while (true) {
      const migration = await applyNextMigration(
        client,
        migrations,
        connectionString,
      );
      if (!migration) break;
      appliedCount += 1;
      console.log(`Applied ${migration.name}`);
    }
    if (appliedCount === 0) console.log("No pending migrations.");
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await client.end();
    } catch (disconnectError) {
      if (operationError !== undefined) {
        throw new AggregateError(
          [operationError, disconnectError],
          "Migration operation and PostgreSQL disconnect both failed.",
        );
      }
      throw disconnectError;
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "status" && command !== "apply") {
    throw new Error("Usage: migrate-pg.ts <status|apply>");
  }
  await run(command);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let reported = false;
  const handleTopLevelError = (error: unknown) => {
    if (reported) return;
    reported = true;
    reportTopLevelError(error);
  };
  process.once("uncaughtException", handleTopLevelError);
  process.once("unhandledRejection", handleTopLevelError);
  void main().catch(handleTopLevelError);
}
