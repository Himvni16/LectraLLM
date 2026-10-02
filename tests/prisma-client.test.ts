import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const adapter = { name: "neon-adapter" };
  const client = { name: "prisma-client" };
  const webSocketConstructor = class WebSocketMock {};

  return {
    adapter,
    client,
    neonConfig: {} as { webSocketConstructor?: unknown },
    PrismaNeon: vi.fn(function PrismaNeonMock() {
      return adapter;
    }),
    PrismaClient: vi.fn(function PrismaClientMock() {
      return client;
    }),
    requireServerEnv: vi.fn(() => "postgresql://pooled.example.test/db"),
    webSocketConstructor,
  };
});

vi.mock("@neondatabase/serverless", () => ({
  neonConfig: mocks.neonConfig,
}));

vi.mock("@prisma/adapter-neon", () => ({
  PrismaNeon: mocks.PrismaNeon,
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: mocks.PrismaClient,
}));

vi.mock("@/lib/env", () => ({
  requireServerEnv: mocks.requireServerEnv,
}));

vi.mock("ws", () => ({
  default: mocks.webSocketConstructor,
}));

const globalWithPrisma = globalThis as typeof globalThis & {
  prisma?: unknown;
};

describe("Prisma Neon runtime client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalWithPrisma.prisma;
    delete mocks.neonConfig.webSocketConstructor;
  });

  afterEach(() => {
    delete globalWithPrisma.prisma;
  });

  it("builds the singleton with the pooled DATABASE_URL and Neon adapter", async () => {
    const { prisma } = await import("@/lib/prisma");

    expect(mocks.requireServerEnv).toHaveBeenCalledWith("DATABASE_URL");
    expect(mocks.neonConfig.webSocketConstructor).toBe(
      mocks.webSocketConstructor,
    );
    expect(mocks.PrismaNeon).toHaveBeenCalledWith({
      connectionString: "postgresql://pooled.example.test/db",
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
    expect(mocks.PrismaNeon).not.toHaveBeenCalled();
    expect(mocks.PrismaClient).not.toHaveBeenCalled();
  });
});
