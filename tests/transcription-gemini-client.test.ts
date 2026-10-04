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
import type { CloudinaryLocatedVideo } from "@/lib/transcription/types";

const video: CloudinaryLocatedVideo = {
  publicId: "lectrallm/videos/c38f8f62-4d06-4f2c-a3ca-d753442e7233",
  fileName: "lecture.mp4",
  contentType: "video/mp4",
  size: 3,
};

describe("Gemini transcription client", () => {
  it("keeps production transcription entrypoints off the FastAPI client", async () => {
    const sources = await Promise.all(
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
      ].map((filePath) => readFile(filePath, "utf8")),
    );

    for (const source of sources) {
      expect(source).toContain("createGeminiTranscriptionClient");
      expect(source).not.toContain("createAiTranscriptionClient");
      expect(source).not.toContain("/transcribe");
    }
  });

  it("uses an authenticated Cloudinary URL and preserves the result contract", async () => {
    const createSignedDownloadUrl = vi.fn(
      () => "https://api.cloudinary.test/video/download?signed=true",
    );
    const transcribe = vi.fn(async () => "  Full lecture transcript.  ");
    const client = createGeminiTranscriptionClient({
      maxSizeBytes: 100,
      model: "gemini-3.8-flash",
      provider: { transcribe },
      videoStore: { createSignedDownloadUrl },
    });

    await expect(client.transcribe(video)).resolves.toEqual({
      text: "Full lecture transcript.",
      language: null,
      durationSeconds: null,
      segments: [],
      model: "gemini-3.8-flash",
    });
    expect(createSignedDownloadUrl).toHaveBeenCalledWith(
      video.publicId,
      "mp4",
      600,
    );
    expect(transcribe).toHaveBeenCalledWith({
      downloadUrl: "https://api.cloudinary.test/video/download?signed=true",
      fileName: video.fileName,
      contentType: video.contentType,
      size: video.size,
      model: "gemini-3.8-flash",
    });
  });

  it("rejects oversized metadata before creating a download URL", async () => {
    const createSignedDownloadUrl = vi.fn(() => "https://unused.test");
    const client = createGeminiTranscriptionClient({
      maxSizeBytes: 2,
      model: "gemini-3.8-flash",
      provider: { transcribe: vi.fn() },
      videoStore: { createSignedDownloadUrl },
    });

    await expect(client.transcribe(video)).rejects.toBeInstanceOf(
      GeminiTranscriptionClientError,
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects empty Gemini output and propagates provider failure safely", async () => {
    const createClient = (provider: GeminiTranscriptionProvider) =>
      createGeminiTranscriptionClient({
        maxSizeBytes: 100,
        model: "gemini-3.8-flash",
        provider,
        videoStore: { createSignedDownloadUrl: () => "https://signed.test" },
      });

    await expect(
      createClient({ transcribe: vi.fn(async () => "   ") }).transcribe(video),
    ).rejects.toThrow("Gemini returned an empty transcript.");
    await expect(
      createClient({
        transcribe: vi.fn(async () => {
          throw new GeminiTranscriptionClientError();
        }),
      }).transcribe(video),
    ).rejects.toBeInstanceOf(GeminiTranscriptionClientError);
  });
});

describe("Gemini Files API transcription provider", () => {
  it("streams one Cloudinary video through resumable upload and sends the exact prompt", async () => {
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
            name: "files/video-1",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/video-1",
            mimeType: "video/mp4",
            state: FileState.ACTIVE,
          },
        }),
      );
    const generateContent = vi.fn(async () => ({ text: "Transcript text" }));
    const deleteFile = vi.fn(async () => ({}));
    const provider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: vi.fn(), delete: deleteFile },
        models: { generateContent },
      },
      fetchImpl,
      timeoutMs: 5_000,
    });

    await expect(
      provider.transcribe({
        downloadUrl: "https://cloudinary.test/private?signed=true",
        fileName: "lecture.mp4",
        contentType: "video/mp4",
        size: 3,
        model: "gemini-3.8-flash",
      }),
    ).resolves.toBe("Transcript text");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/upload/v1beta/files",
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://cloudinary.test/private?signed=true",
    );
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "https://gemini.test/upload/session",
    );
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      body: expect.any(ReadableStream),
      duplex: "half",
      headers: {
        "Content-Length": "3",
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
    });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  fileUri:
                    "https://generativelanguage.googleapis.com/v1beta/files/video-1",
                  mimeType: "video/mp4",
                },
              },
              { text: GEMINI_TRANSCRIPTION_PROMPT },
            ],
          },
        ],
      }),
    );
    expect(deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "files/video-1" }),
    );
  });

  it("fails on provider errors and still deletes an uploaded Gemini file", async () => {
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
            name: "files/video-1",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/video-1",
            mimeType: "video/mp4",
            state: FileState.ACTIVE,
          },
        }),
      );
    const deleteFile = vi.fn(async () => ({}));
    const provider = createGoogleGeminiTranscriptionProvider({
      apiKey: "test-key",
      client: {
        files: { get: vi.fn(), delete: deleteFile },
        models: {
          generateContent: vi.fn(async () => {
            throw new Error("provider detail that must stay server-side");
          }),
        },
      },
      fetchImpl,
      timeoutMs: 5_000,
    });

    await expect(
      provider.transcribe({
        downloadUrl: "https://cloudinary.test/private?signed=true",
        fileName: "lecture.mp4",
        contentType: "video/mp4",
        size: 3,
        model: "gemini-3.8-flash",
      }),
    ).rejects.toThrow("Gemini transcription failed.");
    expect(deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "files/video-1" }),
    );
  });
});
