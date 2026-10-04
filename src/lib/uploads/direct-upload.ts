import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  createCloudinaryVideoStore,
  type CloudinaryVideoMetadata,
  type CloudinaryVideoStore,
} from "@/lib/cloudinary/videos";
import {
  getCloudinaryConfig,
  type UploadLimits,
} from "@/lib/env";
import {
  createSupabasePdfStore,
  type SupabasePdfMetadata,
  type SupabasePdfStore,
} from "@/lib/supabase/pdfs";
import type {
  FinalizeUploadResponse,
  InitiateUploadResponse,
} from "@/lib/uploads/types";
import {
  type UploadSource,
  validateUploadMetadataPair,
} from "@/lib/uploads/validation";

const MANIFEST_VERSION = 1;
const MANIFEST_TTL_MS = 15 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class DirectUploadError extends Error {
  constructor(
    public readonly code:
      | "UPLOAD_INIT_FAILED"
      | "INVALID_UPLOAD_MANIFEST"
      | "UPLOAD_FINALIZATION_FAILED",
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DirectUploadError";
  }
}

interface ManifestFile {
  source: UploadSource;
  originalFileName: string;
  contentType: string;
  size: number;
  extension: string;
}

interface VideoManifestFile extends ManifestFile {
  source: "VIDEO";
  publicId: string;
}

interface PdfManifestFile extends ManifestFile {
  source: "PDF";
  objectPath: string;
}

interface UploadManifestClaims {
  version: typeof MANIFEST_VERSION;
  phase: "initiated" | "finalized";
  uploadId: string;
  expiresAt: number;
  video: VideoManifestFile;
  pdf: PdfManifestFile;
}

export interface FinalizedDirectUpload extends UploadManifestClaims {
  phase: "finalized";
}

export interface DirectUploadDependencies {
  cloudinary?: CloudinaryVideoStore;
  supabase?: SupabasePdfStore;
  manifestSecret?: string;
  uploadFolder?: string;
  now?: () => number;
  createUploadId?: () => string;
}

function getDependencies(dependencies: DirectUploadDependencies) {
  const cloudinaryConfig =
    dependencies.cloudinary &&
    dependencies.manifestSecret &&
    dependencies.uploadFolder
      ? undefined
      : getCloudinaryConfig();
  return {
    cloudinary:
      dependencies.cloudinary ??
      createCloudinaryVideoStore({ config: cloudinaryConfig }),
    supabase: dependencies.supabase ?? createSupabasePdfStore(),
    manifestSecret:
      dependencies.manifestSecret ?? cloudinaryConfig?.apiSecret ?? "",
    uploadFolder:
      dependencies.uploadFolder ?? cloudinaryConfig?.uploadFolder ?? "",
    now: dependencies.now ?? Date.now,
    createUploadId: dependencies.createUploadId ?? randomUUID,
  };
}

export function createCloudinaryPublicId(
  uploadId: string,
  uploadFolder: string,
): string {
  if (!UUID_PATTERN.test(uploadId)) throw new Error("Invalid generated upload ID.");
  return `${uploadFolder}/${uploadId}`;
}

export function createSupabasePdfPath(uploadId: string): string {
  if (!UUID_PATTERN.test(uploadId)) throw new Error("Invalid generated upload ID.");
  return `analyses/${uploadId}/document.pdf`;
}

function encodeManifest(claims: UploadManifestClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function invalidManifest(): DirectUploadError {
  return new DirectUploadError(
    "INVALID_UPLOAD_MANIFEST",
    "The upload manifest is invalid or has expired.",
    400,
  );
}

function decodeManifest(token: string, secret: string): unknown {
  if (typeof token !== "string" || token.length > 16_000) throw invalidManifest();
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw invalidManifest();

  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw invalidManifest();
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw invalidManifest();
  }
}

function isManifestFile(value: unknown): value is ManifestFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<ManifestFile>;
  return (
    (file.source === "VIDEO" || file.source === "PDF") &&
    typeof file.originalFileName === "string" &&
    typeof file.contentType === "string" &&
    typeof file.size === "number" &&
    Number.isSafeInteger(file.size) &&
    file.size > 0 &&
    typeof file.extension === "string"
  );
}

function readManifest(
  token: string,
  expectedPhase: UploadManifestClaims["phase"],
  dependencies: DirectUploadDependencies,
  allowExpired = false,
): UploadManifestClaims {
  const config = getDependencies(dependencies);
  const claims = decodeManifest(token, config.manifestSecret) as Partial<UploadManifestClaims>;
  if (
    claims.version !== MANIFEST_VERSION ||
    claims.phase !== expectedPhase ||
    typeof claims.uploadId !== "string" ||
    !UUID_PATTERN.test(claims.uploadId) ||
    typeof claims.expiresAt !== "number" ||
    (!allowExpired && claims.expiresAt < config.now()) ||
    !isManifestFile(claims.video) ||
    claims.video.source !== "VIDEO" ||
    typeof (claims.video as Partial<VideoManifestFile>).publicId !== "string" ||
    !isManifestFile(claims.pdf) ||
    claims.pdf.source !== "PDF" ||
    typeof (claims.pdf as Partial<PdfManifestFile>).objectPath !== "string"
  ) {
    throw invalidManifest();
  }

  const video = claims.video as VideoManifestFile;
  const pdf = claims.pdf as PdfManifestFile;
  if (
    video.publicId !==
      createCloudinaryPublicId(claims.uploadId, config.uploadFolder) ||
    pdf.objectPath !== createSupabasePdfPath(claims.uploadId)
  ) {
    throw invalidManifest();
  }
  return claims as UploadManifestClaims;
}

function assertVideoMetadata(
  file: VideoManifestFile,
  metadata: CloudinaryVideoMetadata,
  limits: UploadLimits,
): void {
  const expectedFormat = file.extension.slice(1);
  let secureUrl: URL;
  try {
    secureUrl = new URL(metadata.secureUrl);
  } catch {
    throw new Error("Cloudinary returned an invalid delivery URL.");
  }
  if (
    metadata.publicId !== file.publicId ||
    metadata.resourceType !== "video" ||
    metadata.deliveryType !== "authenticated" ||
    metadata.format !== expectedFormat ||
    metadata.bytes !== file.size ||
    metadata.bytes > limits.videoMaxSizeBytes ||
    secureUrl.protocol !== "https:" ||
    secureUrl.hostname !== "res.cloudinary.com"
  ) {
    throw new Error("Cloudinary video metadata did not match the selected file.");
  }
}

function assertPdfMetadata(
  file: PdfManifestFile,
  metadata: SupabasePdfMetadata,
  limits: UploadLimits,
): void {
  if (
    metadata.objectPath !== file.objectPath ||
    metadata.contentType !== "application/pdf" ||
    metadata.size !== file.size ||
    metadata.size > limits.pdfMaxSizeBytes
  ) {
    throw new Error("Supabase PDF metadata did not match the selected file.");
  }
}

async function cleanUp(
  claims: Pick<UploadManifestClaims, "video" | "pdf">,
  cloudinary: CloudinaryVideoStore,
  supabase: SupabasePdfStore,
): Promise<void> {
  const results = await Promise.allSettled([
    cloudinary.delete(claims.video.publicId),
    supabase.delete(claims.pdf.objectPath),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to clean up a direct upload.", result.reason);
    }
  }
}

export async function initiateDirectUpload(
  body: unknown,
  limits: UploadLimits,
  dependencies: DirectUploadDependencies = {},
): Promise<InitiateUploadResponse> {
  const validated = validateUploadMetadataPair(body, limits);
  const deps = getDependencies(dependencies);
  const uploadId = deps.createUploadId();
  const publicId = createCloudinaryPublicId(uploadId, deps.uploadFolder);
  const objectPath = createSupabasePdfPath(uploadId);
  const timestamp = Math.floor(deps.now() / 1000);
  const expiresAt = deps.now() + MANIFEST_TTL_MS;

  try {
    const video = deps.cloudinary.authorizeUpload(publicId, timestamp);
    const pdf = await deps.supabase.authorizeUpload(objectPath);
    const claims: UploadManifestClaims = {
      version: MANIFEST_VERSION,
      phase: "initiated",
      uploadId,
      expiresAt,
      video: { ...validated.video, source: "VIDEO", publicId },
      pdf: { ...validated.pdf, source: "PDF", objectPath },
    };
    return {
      uploadManifest: encodeManifest(claims, deps.manifestSecret),
      expiresAt: new Date(expiresAt).toISOString(),
      video,
      pdf,
    };
  } catch (error) {
    throw new DirectUploadError(
      "UPLOAD_INIT_FAILED",
      "The upload could not be prepared. Please try again.",
      500,
      { cause: error },
    );
  }
}

export async function verifyDirectUpload(
  claims: UploadManifestClaims,
  limits: UploadLimits,
  dependencies: DirectUploadDependencies = {},
): Promise<void> {
  const deps = getDependencies(dependencies);
  const [video, pdf] = await Promise.all([
    deps.cloudinary.inspect(claims.video.publicId),
    deps.supabase.inspect(claims.pdf.objectPath),
  ]);
  assertVideoMetadata(claims.video, video, limits);
  assertPdfMetadata(claims.pdf, pdf, limits);
}

export async function finalizeDirectUpload(
  body: unknown,
  limits: UploadLimits,
  dependencies: DirectUploadDependencies = {},
): Promise<FinalizeUploadResponse> {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { uploadManifest?: unknown }).uploadManifest !== "string"
  ) {
    throw invalidManifest();
  }
  const deps = getDependencies(dependencies);
  const claims = readManifest(
    (body as { uploadManifest: string }).uploadManifest,
    "initiated",
    dependencies,
  );
  try {
    await verifyDirectUpload(claims, limits, dependencies);
  } catch (error) {
    await cleanUp(claims, deps.cloudinary, deps.supabase);
    throw new DirectUploadError(
      "UPLOAD_FINALIZATION_FAILED",
      "The uploaded files could not be verified. Please try again.",
      400,
      { cause: error },
    );
  }

  const finalized: FinalizedDirectUpload = {
    ...claims,
    phase: "finalized",
    expiresAt: deps.now() + MANIFEST_TTL_MS,
  };
  return {
    uploadManifest: encodeManifest(finalized, deps.manifestSecret),
    expiresAt: new Date(finalized.expiresAt).toISOString(),
  };
}

export function readFinalizedDirectUpload(
  token: string,
  dependencies: DirectUploadDependencies = {},
): FinalizedDirectUpload {
  return readManifest(token, "finalized", dependencies) as FinalizedDirectUpload;
}

export async function abortDirectUpload(
  body: unknown,
  dependencies: DirectUploadDependencies = {},
): Promise<void> {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { uploadManifest?: unknown }).uploadManifest !== "string"
  ) {
    return;
  }
  const deps = getDependencies(dependencies);
  const claims = readManifest(
    (body as { uploadManifest: string }).uploadManifest,
    "initiated",
    dependencies,
    true,
  );
  await cleanUp(claims, deps.cloudinary, deps.supabase);
}

export async function cleanUpDirectUpload(
  claims: FinalizedDirectUpload,
  dependencies: DirectUploadDependencies = {},
): Promise<void> {
  const deps = getDependencies(dependencies);
  await cleanUp(claims, deps.cloudinary, deps.supabase);
}
