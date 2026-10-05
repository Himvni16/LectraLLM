import { FileState } from "@google/genai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createGeminiTranscriptionClient,
  createGoogleGeminiTranscriptionProvider,
  GEMINI_TRANSCRIPTION_PROMPT,
  GeminiTranscriptionClientError,
  type GeminiTranscriptionProvider,
} from "@/lib/transcription/gemini-client";
import type {
  CloudinaryLocatedVideo,
  TranscriptionProviderFile,
} from "@/lib/transcription/types";

const video: CloudinaryLocatedVideo = {
  publicId: "lectrallm/videos/c38f8f62-4d06-4f2c-a3ca-d753442e7233",
  fileName: "lecture.mp4",
  contentType: "video/mp4",
  size: 3,
};
const processingFile: TranscriptionProviderFile = {
  name: "files/video-1",
  state: "PROCESSING",
  uri: null,
  mimeType: null,
};
const activeFile: TranscriptionProviderFile = {
  name: "files/video-1",
  state: "ACTIVE",
  uri: "https://generativelanguage.googleapis.com/v1beta/files/video-1",
  mimeType: "video/mp4",
};

function provider(
  overrides: Partial<GeminiTranscriptionProvider> = {},
): GeminiTranscriptionProvider {
  return {
    upload: vi.fn(async () => processingFile),
    getFile: vi.fn(async () => processingFile),
    generate: vi.fn(async () => "Transcript text"),
    deleteFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Gemini transcription client", () => {
  it("keeps production transcription entrypoints off FastAPI and long polling loops", async () => {
    const [routeSource, pipelineSource, clientSource] = await Promise.all(
      [
        path.join(
          process.cwd(),
          "src",
          "app",
          "api",
          "analyses",
          "[id]",
          "transcribe",
          "route.ts",
        ),
        path.join(
          process.cwd(),
          "src",
          "lib",
          "analysis-pipeline",
          "workflow.ts",
        ),
        path.join(
          process.cwd(),
          "src",
          "lib",
          "transcription",
          "gemini-client.ts",
        ),
      ].map((filePath) => readFile(filePath, "utf8")),
    );

    expect(routeSource).toContain("respondToAnalysisRun");
    expect(pipelineSource).toContain("createGeminiTranscriptionClient");
    expect(clientSource).not.toContain("waitForActiveFile");
    expect(clientSource).not.toMatch(/while\s*\(/);
    for (const source of [routeSource, pipelineSource]) {
      expect(source).not.toContain("createAiTranscriptionClient");
      expect(source).not.toContain("/transcribe");
    }
  });

  it("uploads through an authenticated Cloudinary URL and delegates resumable operations", async () => {
    const createSignedDownloadUrl = vi.fn(
      () => "https://api.cloudinary.test/video/download?signed=true",
    );
    const mockProvider = provider({
      generate: vi.fn(async () => "  Full lecture transcript.  "),
    });
    const client = createGeminiTranscriptionClient({
      maxSizeBytes: 100,
      model: "gemini-3.8-flash",
      provider: mockProvider,
      videoStore: { createSignedDownloadUrl },
    });

    await expect(client.upload(video)).resolves.toEqual(processingFile);
    expect(createSignedDownloadUrl).toHaveBeenCalledWith(
      video.publicId,
      "mp4",
      600,
    );
    expect(mockProvider.upload).toHaveBeenCalledWith({
      downloadUrl: "https://api.cloudinary.test/video/download?signed=true",
      fileName: video.fileName,
      contentType: video.contentType,
      size: video.size,
    });

    await client.getFile(processingFile.name);
    expect(mockProvider.getFile).toHaveBeenCalledWith(processingFile.name);
    await expect(client.generate(activeFile)).resolves.toEqual({
      text: "Full lecture transcript.",
      language: null,
      durationSeconds: null,
      segments: [],
      model: "gemini-3.8-flash",
    });
    await client.deleteFile(activeFile.name);
    expect(mockProvider.deleteFile).toHaveBeenCalledWith(activeFile.name);
  });

  it("rejects invalid metadata and empty transcript output", async () => {
    const createSignedDownloadUrl = vi.fn(() => "https://unused.test");
    const client = createGeminiTranscriptionClient({
      maxSizeBytes: 2,
      model: "gemini-3.8-flash",
      provider: provider({ generate: vi.fn(async () => "   ") }),
      videoStore: { createSignedDownloadUrl },
    });

    await expect(client.upload(video)).rejects.toBeInstanceOf(
      GeminiTranscriptionClientError,
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
    await expect(client.generate(activeFile)).rejects.toThrow(
      "Gemini returned an empty transcript.",
    );
  });
});

describe("Gemini Files API resumable provider", () => {
  it("streams one Cloudinary video and returns immediately after upload", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": "https://gemini.test/upload/session" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          file: {
            name: processingFile.name,
            state: FileState.PROCESSING,
          },
        }),
      );
    const getFile = vi.fn();
    const generateContent = vi.fn();
    const geminiProvider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: getFile, delete: vi.fn() },
        models: { generateContent },
      },
      fetchImpl,
      timeoutMs: 5_000,
    });

    await expect(
      geminiProvider.upload({
        downloadUrl: "https://cloudinary.test/private?signed=true",
        fileName: "lecture.mp4",
        contentType: "video/mp4",
        size: 3,
      }),
    ).resolves.toEqual(processingFile);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      body: expect.any(ReadableStream),
      duplex: "half",
      headers: {
        "Content-Length": "3",
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
    });
    expect(getFile).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("checks PROCESSING once without polling or generating", async () => {
    const getFile = vi.fn(async () => ({
      name: processingFile.name,
      state: FileState.PROCESSING,
    }));
    const generateContent = vi.fn();
    const geminiProvider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: getFile, delete: vi.fn() },
        models: { generateContent },
      },
      timeoutMs: 5_000,
    });

    await expect(geminiProvider.getFile(processingFile.name)).resolves.toEqual(
      processingFile,
    );
    expect(getFile).toHaveBeenCalledOnce();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("generates only from an ACTIVE file with the existing model and prompt", async () => {
    const generateContent = vi.fn(async () => ({ text: "Transcript text" }));
    const geminiProvider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: {
          get: vi.fn(async () => ({
            name: activeFile.name,
            state: FileState.ACTIVE,
            uri: activeFile.uri!,
            mimeType: activeFile.mimeType!,
          })),
          delete: vi.fn(),
        },
        models: { generateContent },
      },
      timeoutMs: 5_000,
    });

    const inspected = await geminiProvider.getFile(activeFile.name);
    await expect(
      geminiProvider.generate(inspected, "gemini-3.8-flash"),
    ).resolves.toBe("Transcript text");
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  fileUri: activeFile.uri,
                  mimeType: activeFile.mimeType,
                },
              },
              { text: GEMINI_TRANSCRIPTION_PROMPT },
            ],
          },
        ],
      }),
    );
  });

  it("maps an expired provider file to NOT_FOUND", async () => {
    const getFile = vi.fn(async () => {
      throw { status: 404 };
    });
    const geminiProvider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: getFile, delete: vi.fn() },
        models: { generateContent: vi.fn() },
      },
      timeoutMs: 5_000,
    });

    await expect(geminiProvider.getFile(activeFile.name)).resolves.toEqual({
      name: activeFile.name,
      state: "NOT_FOUND",
      uri: null,
      mimeType: null,
    });
  });

  it("treats Gemini file deletion as best-effort", async () => {
    const deleteFile = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const geminiProvider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: vi.fn(), delete: deleteFile },
        models: { generateContent: vi.fn() },
      },
      timeoutMs: 5_000,
    });

    await expect(geminiProvider.deleteFile(activeFile.name)).resolves.toBeUndefined();
    expect(deleteFile).toHaveBeenCalledOnce();
  });
});
