import type { PoolConfig } from "pg";

const SUPABASE_POOLER_SUFFIX = ".pooler.supabase.com";
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";
const SSL_QUERY_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
] as const;

export function isSupabaseTransactionPooler(
  connectionString: string,
): boolean {
  const url = new URL(connectionString);
  return (
    url.hostname.toLowerCase().endsWith(SUPABASE_POOLER_SUFFIX) &&
    url.port === SUPABASE_TRANSACTION_POOLER_PORT
  );
}

export function createPostgresConnectionConfig(
  connectionString: string,
): PoolConfig {
  if (!isSupabaseTransactionPooler(connectionString)) {
    return { connectionString };
  }

  const normalizedUrl = new URL(connectionString);
  for (const parameter of SSL_QUERY_PARAMETERS) {
    normalizedUrl.searchParams.delete(parameter);
  }

  return {
    connectionString: normalizedUrl.toString(),
    ssl: {
      rejectUnauthorized: false,
    },
  };
}
