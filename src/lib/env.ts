import "server-only";

type ServerEnvName = "DATABASE_URL" | "AI_SERVICE_URL";

export function requireServerEnv(name: ServerEnvName): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env.local and provide a value.`,
    );
  }

  return value;
}

export function getAiServiceUrl(): string {
  const value = requireServerEnv("AI_SERVICE_URL");

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      "AI_SERVICE_URL must be a valid absolute URL, for example http://127.0.0.1:8000.",
    );
  }
}

export function validateServerEnv(): void {
  requireServerEnv("DATABASE_URL");
  getAiServiceUrl();
}
