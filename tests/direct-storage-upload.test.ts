import { AnalysisStatus } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createCloudinaryVideoStore,
  type CloudinaryVideoStore,
} from "@/lib/cloudinary/videos";
import type { CloudinaryConfig, UploadLimits } from "@/lib/env";
import {
  createSupabasePdfStore,
  type SupabasePdfStore,
} from "@/lib/supabase/pdfs";
import { createAnalysisFromDirectUpload } from "@/lib/uploads/direct-analysis";
import {
  finalizeDirectUpload,
  initiateDirectUpload,
  readFinalizedDirectUpload,
  type DirectUploadDependencies,
} from "@/lib/uploads/direct-upload";
import type { AnalysisRepository } from "@/lib/uploads/types";

const uploadId = "c38f8f62-4d06-4f2c-a3ca-d753442e7233";
const publicId = `lectrallm/videos/${uploadId}`;
const objectPath = `analyses/${uploadId}/document.pdf`;
const now = 1_800_000_000_000;
const limits: UploadLimits = {
  videoMaxSizeMb: 100,
  pdfMaxSizeMb: 25,
  videoMaxSizeBytes: 100 * 1024 * 1024,
  pdfMaxSizeBytes: 25 * 1024 * 1024,
};
const request = {
  files: [
    {
      source: "VIDEO",
      originalFileName: "lecture.mp4",
      contentType: "video/mp4",
      size: 21,
    },
    {
      source: "PDF",
      originalFileName: "slides.pdf",
      contentType: "application/pdf",
      size: 9,
    },
  ],
};

function createMocks() {
  const cloudinary: CloudinaryVideoStore = {
    authorizeUpload: vi.fn((authorizedPublicId, timestamp) => ({
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/video/upload",
      cloudName: "cloud",
      apiKey: "api-key",
      publicId: authorizedPublicId,
      timestamp,
      signature: "signed",
    })),
    inspect: vi.fn(async () => ({
      publicId,
      resourceType: "video",
      deliveryType: "authenticated",
      format: "mp4",
      bytes: 21,
      secureUrl: "https://res.cloudinary.com/cloud/video/upload/lecture.mp4",
    })),
    createSignedDownloadUrl: vi.fn(
      () => "https://api.cloudinary.com/video/download?signed=true",
    ),
    delete: vi.fn(async () => undefined),
  };
  const supabase: SupabasePdfStore = {
    authorizeUpload: vi.fn(async (authorizedPath) => ({
      objectPath: authorizedPath,
      signedUrl: "https://project.supabase.co/storage/v1/object/upload/sign/pdfs/path?token=signed",
      expiresInSeconds: 7200,
    })),
    inspect: vi.fn(async () => ({
      objectPath,
      contentType: "application/pdf",
      size: 9,
    })),
    getBytes: vi.fn(async () => new Uint8Array(9)),
    delete: vi.fn(async () => undefined),
  };
  const dependencies: DirectUploadDependencies = {
    cloudinary,
    supabase,
    manifestSecret: "manifest-secret",
    uploadFolder: "lectrallm/videos",
    now: () => now,
    createUploadId: () => uploadId,
  };
  return { cloudinary, supabase, dependencies };
}

async function createFinalized(mocks = createMocks()) {
  const initiated = await initiateDirectUpload(request, limits, mocks.dependencies);
  const finalized = await finalizeDirectUpload(
    { uploadManifest: initiated.uploadManifest },
    limits,
    mocks.dependencies,
  );
  return { ...mocks, initiated, finalized };
}

describe("Cloudinary and Supabase direct uploads", () => {
  it("creates a Supabase signed upload URL for the exact private object path", async () => {
    const createSignedUploadUrl = vi.fn(async () => ({
      data: {
        signedUrl: "https://project.supabase.co/storage/v1/object/upload/sign/pdfs/path?token=signed",
        token: "signed",
        path: objectPath,
      },
      error: null,
    }));
    const from = vi.fn(() => ({ createSignedUploadUrl }));
    const client = { storage: { from } } as unknown as SupabaseClient;
    const store = createSupabasePdfStore({
      config: {
        url: "https://project.supabase.co",
        serviceRoleKey: "service-role",
        bucket: "pdfs",
      },
      client,
    });

    await expect(store.authorizeUpload(objectPath)).resolves.toMatchObject({
      objectPath,
      expiresInSeconds: 7200,
    });
    expect(from).toHaveBeenCalledWith("pdfs");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(objectPath, {
      upsert: false,
    });
  });

  it("creates a signed Cloudinary authorization without exposing its secret", () => {
    const config: CloudinaryConfig = {
      cloudName: "cloud",
      apiKey: "api-key",
      apiSecret: "never-expose-this",
      uploadFolder: "lectrallm/videos",
    };
    const authorization = createCloudinaryVideoStore({ config }).authorizeUpload(
      publicId,
      1_800_000_000,
    );

    expect(authorization).toMatchObject({
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/video/upload",
      apiKey: "api-key",
      publicId,
      timestamp: 1_800_000_000,
    });
    expect(authorization.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(authorization)).not.toContain(config.apiSecret);
  });

  it("creates a short-lived authenticated Cloudinary video URL", () => {
    const config: CloudinaryConfig = {
      cloudName: "cloud",
      apiKey: "api-key",
      apiSecret: "never-expose-this",
      uploadFolder: "lectrallm/videos",
    };
    const url = createCloudinaryVideoStore({ config }).createSignedDownloadUrl(
      publicId,
      "mp4",
      300,
    );

    expect(url).toContain("/video/download");
    expect(url).toContain("expires_at=");
    expect(url).toContain("signature=");
    expect(url).not.toContain(config.apiSecret);
  });

  it("authorizes only generated Cloudinary and Supabase paths", async () => {
    const mocks = createMocks();
    const result = await initiateDirectUpload(request, limits, mocks.dependencies);

    expect(result.video.publicId).toBe(publicId);
    expect(result.pdf.objectPath).toBe(objectPath);
    expect(mocks.cloudinary.authorizeUpload).toHaveBeenCalledWith(
      publicId,
      Math.floor(now / 1000),
    );
    expect(mocks.supabase.authorizeUpload).toHaveBeenCalledWith(objectPath);
  });

  it("rejects tampered manifests and foreign provider identifiers", async () => {
    const result = await createFinalized();
    const tampered = `${result.finalized.uploadManifest.slice(0, -1)}x`;
    expect(() =>
      readFinalizedDirectUpload(tampered, result.dependencies),
    ).toThrow("invalid or has expired");
  });

  it("validates Cloudinary and Supabase metadata during finalization", async () => {
    const mocks = createMocks();
    vi.mocked(mocks.cloudinary.inspect).mockResolvedValue({
      publicId: "lectrallm/videos/foreign",
      resourceType: "video",
      deliveryType: "authenticated",
      format: "mp4",
      bytes: 21,
      secureUrl: "https://res.cloudinary.com/cloud/video/upload/lecture.mp4",
    });
    const initiated = await initiateDirectUpload(request, limits, mocks.dependencies);

    await expect(
      finalizeDirectUpload(
        { uploadManifest: initiated.uploadManifest },
        limits,
        mocks.dependencies,
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_FINALIZATION_FAILED" });
    expect(mocks.cloudinary.delete).toHaveBeenCalledWith(publicId);
    expect(mocks.supabase.delete).toHaveBeenCalledWith(objectPath);
  });

  it("rejects a Supabase object with the wrong type or size", async () => {
    const mocks = createMocks();
    vi.mocked(mocks.supabase.inspect).mockResolvedValue({
      objectPath,
      contentType: "text/plain",
      size: 9,
    });
    const initiated = await initiateDirectUpload(request, limits, mocks.dependencies);
    await expect(
      finalizeDirectUpload(
        { uploadManifest: initiated.uploadManifest },
        limits,
        mocks.dependencies,
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_FINALIZATION_FAILED" });
  });

  it("creates an analysis with provider identifiers", async () => {
    const result = await createFinalized();
    const createUploaded = vi.fn<AnalysisRepository["createUploaded"]>(
      async (data) => ({
        id: "analysis-1",
        status: data.status,
        videoFileName: data.videoFileName,
        pdfFileName: data.pdfFileName,
      }),
    );
    await expect(
      createAnalysisFromDirectUpload(result.finalized.uploadManifest, limits, {
        ...result.dependencies,
        cloudinary: result.cloudinary,
        supabase: result.supabase,
        repository: { createUploaded },
      }),
    ).resolves.toMatchObject({
      analysisId: "analysis-1",
      status: AnalysisStatus.UPLOADED,
    });
    expect(createUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        videoStoragePath: publicId,
        pdfStoragePath: objectPath,
      }),
    );
  });

  it("cleans up both provider objects when database creation fails", async () => {
    const result = await createFinalized();
    const repository: AnalysisRepository = {
      createUploaded: vi.fn(async () => {
        throw new Error("Database unavailable");
      }),
    };
    await expect(
      createAnalysisFromDirectUpload(result.finalized.uploadManifest, limits, {
        ...result.dependencies,
        cloudinary: result.cloudinary,
        supabase: result.supabase,
        repository,
      }),
    ).rejects.toThrow("Database unavailable");
    expect(result.cloudinary.delete).toHaveBeenCalledWith(publicId);
    expect(result.supabase.delete).toHaveBeenCalledWith(objectPath);
  });
});
