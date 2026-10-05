import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { name: "prisma-client" };

  return {
    client,
    PrismaClient: vi.fn(function PrismaClientMock() {
      return client;
    }),
  };
});

vi.mock("@prisma/client", () => ({
  PrismaClient: mocks.PrismaClient,
}));

const globalWithPrisma = globalThis as typeof globalThis & {
  prisma?: unknown;
};

describe("Prisma PostgreSQL runtime client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalWithPrisma.prisma;
  });

  afterEach(() => {
    delete globalWithPrisma.prisma;
  });

  it("builds the singleton with the schema-configured PostgreSQL datasource", async () => {
    const { prisma } = await import("@/lib/prisma");

    expect(mocks.PrismaClient).toHaveBeenCalledWith();
    expect(prisma).toBe(mocks.client);
  });

  it("reuses the global client during development reloads", async () => {
    const firstModule = await import("@/lib/prisma");

    vi.resetModules();
    vi.clearAllMocks();

    const secondModule = await import("@/lib/prisma");

    expect(secondModule.prisma).toBe(firstModule.prisma);
    expect(mocks.PrismaClient).not.toHaveBeenCalled();
  });
});
