import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getSupabaseStorageConfig,
  type SupabaseStorageConfig,
} from "@/lib/env";

export interface SupabasePdfMetadata {
  objectPath: string;
  contentType: string;
  size: number;
}

export interface SupabasePdfUploadAuthorization {
  objectPath: string;
  signedUrl: string;
  expiresInSeconds: number;
}

export interface SupabasePdfStore {
  authorizeUpload(objectPath: string): Promise<SupabasePdfUploadAuthorization>;
  inspect(objectPath: string): Promise<SupabasePdfMetadata>;
  getBytes(objectPath: string, maxSizeBytes: number): Promise<Uint8Array>;
  delete(objectPath: string): Promise<void>;
}

interface SupabasePdfStoreOptions {
  config?: SupabaseStorageConfig;
  client?: SupabaseClient;
}

const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

export function createSupabasePdfStore(
  options: SupabasePdfStoreOptions = {},
): SupabasePdfStore {
  const config = options.config ?? getSupabaseStorageConfig();
  const client =
    options.client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const bucket = client.storage.from(config.bucket);

  return {
    async authorizeUpload(objectPath) {
      const { data, error } = await bucket.createSignedUploadUrl(objectPath, {
        upsert: false,
      });
      if (error || !data?.signedUrl) {
        throw new Error("Supabase could not authorize the PDF upload.");
      }
      return {
        objectPath,
        signedUrl: data.signedUrl,
        expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
      };
    },

    async inspect(objectPath) {
      const { data, error } = await bucket.info(objectPath);
      if (error || !data) throw new Error("Supabase PDF is unavailable.");
      const contentType = (
        data.contentType ??
        (typeof data.metadata?.mimetype === "string"
          ? data.metadata.mimetype
          : "")
      )
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const size =
        data.size ??
        (typeof data.metadata?.size === "number" ? data.metadata.size : NaN);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("Supabase returned invalid PDF metadata.");
      }
      return { objectPath, contentType, size };
    },

    async getBytes(objectPath, maxSizeBytes) {
      const metadata = await this.inspect(objectPath);
      if (metadata.size <= 0 || metadata.size > maxSizeBytes) {
        throw new Error("Supabase PDF size is outside the allowed range.");
      }
      const { data, error } = await bucket.download(objectPath);
      if (error || !data) throw new Error("Supabase PDF could not be downloaded.");
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength !== metadata.size || bytes.byteLength > maxSizeBytes) {
        throw new Error("Supabase PDF body does not match its metadata.");
      }
      return bytes;
    },

    async delete(objectPath) {
      const { error } = await bucket.remove([objectPath]);
      if (error) throw new Error("Supabase PDF cleanup failed.");
    },
  };
}
