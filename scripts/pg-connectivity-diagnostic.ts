import process from "node:process";

import type { Client as PgClient, ClientConfig } from "pg";

import { createPostgresConnectionConfig } from "../src/lib/postgres-config";

const CONNECTION_TIMEOUT_MS = 75_000;
const ENVIRONMENT_VARIABLES = ["DATABASE_URL", "DIRECT_URL"] as const;

type EnvironmentVariable = (typeof ENVIRONMENT_VARIABLES)[number];

interface SafeConnectionDetails {
  hostname: string;
  port: string;
  username: string;
  usernameShape: string;
  password: string;
  sslModePresent: boolean;
}

interface SafeErrorFields {
  code?: string;
  message?: string;
  severity?: string;
}

function usernameShape(username: string): string {
  const segments = username.split(".");
  if (segments.length > 1) {
    return `${segments[0]}.[PROJECT_REF]`;
  }
  return `[USERNAME:${username.length} chars]`;
}

function parseConnectionString(connectionString: string): SafeConnectionDetails {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Connection string does not use the PostgreSQL protocol.");
  }

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  return {
    hostname: parsed.hostname,
    port: parsed.port || "5432",
    username,
    usernameShape: usernameShape(username),
    password,
    sslModePresent: parsed.searchParams.has("sslmode"),
  };
}

function safeErrorFields(
  error: unknown,
  details?: SafeConnectionDetails,
): SafeErrorFields {
  const queue = [error];
  const seen = new Set<unknown>();
  let selected: SafeErrorFields = {};
  let selectedScore = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "string" && current.trim()) {
      if (selectedScore < 4) {
        selected = { message: current.trim() };
        selectedScore = 4;
      }
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    const candidate = current as Record<string, unknown>;
    const stringField = (name: string) => {
      const value = candidate[name];
      return typeof value === "string" && value.trim()
        ? value.trim()
        : undefined;
    };
    const fields = {
      code: stringField("code"),
      message: stringField("message"),
      severity: stringField("severity"),
    };
    const score =
      (fields.message ? 4 : 0) +
      (fields.code ? 2 : 0) +
      (fields.severity ? 1 : 0);
    if (score > selectedScore) {
      selected = fields;
      selectedScore = score;
    }
    if (Array.isArray(candidate.errors)) queue.push(...candidate.errors);
    if (candidate.cause !== undefined) queue.push(candidate.cause);
  }

  let message = selected.message ?? "Unknown PostgreSQL connection error.";
  const secrets = [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.PGPASSWORD,
    details?.password,
  ].filter((value): value is string => Boolean(value));
  for (const secret of secrets.sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  if (details?.username) {
    message = message.replaceAll(details.username, details.usernameShape);
  }
  message = message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_CONNECTION_STRING]")
    .replace(/\b(password\s*[=:]\s*)[^\s;]+/gi, "$1[REDACTED]");

  return {
    code: selected.code,
    message,
    severity: selected.severity,
  };
}

function printSafeError(error: unknown, details?: SafeConnectionDetails): void {
  const fields = safeErrorFields(error, details);
  if (fields.code) console.error(`  Error code: ${fields.code}`);
  console.error(`  Error message: ${fields.message}`);
  if (fields.severity) console.error(`  Error severity: ${fields.severity}`);
}

async function diagnose(
  variableName: EnvironmentVariable,
  ClientConstructor: new (options: ClientConfig) => PgClient,
): Promise<boolean> {
  console.log(variableName);
  const connectionString = process.env[variableName]?.trim();
  if (!connectionString) {
    console.error("  Error message: Environment variable is not configured.");
    return false;
  }

  let details: SafeConnectionDetails;
  try {
    details = parseConnectionString(connectionString);
  } catch (error) {
    printSafeError(error);
    return false;
  }

  console.log(`  Hostname: ${details.hostname}`);
  console.log(`  Port: ${details.port}`);
  console.log(`  Username shape: ${details.usernameShape}`);
  console.log(`  sslmode present: ${details.sslModePresent ? "yes" : "no"}`);

  const client = new ClientConstructor({
    ...createPostgresConnectionConfig(connectionString),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  let succeeded = false;
  try {
    const startedAt = performance.now();
    try {
      await client.connect();
      const connectionMilliseconds = Math.round(performance.now() - startedAt);
      console.log(
        `  Connection establishment: succeeded (${connectionMilliseconds} ms)`,
      );
    } catch (error) {
      const connectionMilliseconds = Math.round(performance.now() - startedAt);
      console.error(
        `  Connection establishment: failed (${connectionMilliseconds} ms)`,
      );
      printSafeError(error, details);
      return false;
    }

    try {
      const result = await client.query<{ value: number }>("SELECT 1 AS value");
      console.log(
        `  SELECT 1: succeeded (value ${result.rows[0]?.value ?? "missing"})`,
      );
      succeeded = result.rows[0]?.value === 1;
    } catch (error) {
      console.error("  SELECT 1: failed");
      printSafeError(error, details);
    }
  } finally {
    try {
      await client.end();
      console.log("  Client closed: yes");
    } catch (error) {
      console.error("  Client closed: no");
      printSafeError(error, details);
      succeeded = false;
    }
  }
  return succeeded;
}

async function main(): Promise<void> {
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
  if (!loadEnvConfig) throw new Error("Next.js environment loading is unavailable.");
  loadEnvConfig(process.cwd());

  const pgCandidate = pgModule as unknown as {
    Client?: new (options: ClientConfig) => PgClient;
    default?: {
      Client?: new (options: ClientConfig) => PgClient;
    };
  };
  const ClientConstructor = pgCandidate.Client ?? pgCandidate.default?.Client;
  if (!ClientConstructor) throw new Error("The PostgreSQL driver is unavailable.");

  console.log(`PostgreSQL connectivity diagnostic (timeout ${CONNECTION_TIMEOUT_MS} ms)`);
  const results = [];
  for (const variableName of ENVIRONMENT_VARIABLES) {
    results.push(await diagnose(variableName, ClientConstructor));
  }
  if (results.some((succeeded) => !succeeded)) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("PostgreSQL connectivity diagnostic failed.");
  printSafeError(error);
  process.exitCode = 1;
});
