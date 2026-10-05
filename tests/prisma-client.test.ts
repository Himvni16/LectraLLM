import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { name: "prisma-client" };
  const adapter = { name: "prisma-pg-adapter" };

  return {
    adapter,
    client,
    PrismaClient: vi.fn(function PrismaClientMock(options: unknown) {
      void options;
      return client;
    }),
    PrismaPg: vi.fn(function PrismaPgMock(config: unknown) {
      void config;
      return adapter;
    }),
  };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: mocks.PrismaPg,
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: mocks.PrismaClient,
}));

const globalWithPrisma = globalThis as typeof globalThis & {
  prisma?: unknown;
};
const originalDatabaseUrl = process.env.DATABASE_URL;

describe("Prisma PostgreSQL runtime client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalWithPrisma.prisma;
    process.env.DATABASE_URL =
      "postgresql://postgres.project-ref:runtime-password@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";
  });

  afterEach(() => {
    delete globalWithPrisma.prisma;
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("builds the singleton with PrismaPg and the runtime DATABASE_URL", async () => {
    const { prisma } = await import("@/lib/prisma");

    expect(mocks.PrismaPg).toHaveBeenCalledWith({
      connectionString:
        "postgresql://postgres.project-ref:runtime-password@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true",
      ssl: {
        rejectUnauthorized: false,
      },
    });
    expect(mocks.PrismaClient).toHaveBeenCalledWith({
      adapter: mocks.adapter,
    });
    expect(prisma).toBe(mocks.client);
  });

  it("reuses the global client during development reloads", async () => {
    const firstModule = await import("@/lib/prisma");

    vi.resetModules();
    vi.clearAllMocks();

    const secondModule = await import("@/lib/prisma");

    expect(secondModule.prisma).toBe(firstModule.prisma);
    expect(mocks.PrismaPg).not.toHaveBeenCalled();
    expect(mocks.PrismaClient).not.toHaveBeenCalled();
  });
});
