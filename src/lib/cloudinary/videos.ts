import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { getCloudinaryConfig, type CloudinaryConfig } from "@/lib/env";

export interface CloudinaryVideoMetadata {
  publicId: string;
  resourceType: string;
  deliveryType: string;
  format: string;
  bytes: number;
  secureUrl: string;
}

export interface CloudinaryUploadAuthorization {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  publicId: string;
  timestamp: number;
  signature: string;
}

export interface CloudinaryVideoStore {
  authorizeUpload(
    publicId: string,
    timestamp: number,
  ): CloudinaryUploadAuthorization;
  inspect(publicId: string): Promise<CloudinaryVideoMetadata>;
  createSignedDownloadUrl(
    publicId: string,
    format: string,
    expiresInSeconds?: number,
  ): string;
  delete(publicId: string): Promise<void>;
}

interface CloudinaryVideoStoreOptions {
  config?: CloudinaryConfig;
}

function configuredCloudinary(config: CloudinaryConfig) {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });
  return cloudinary;
}

function readMetadata(value: unknown, publicId: string): CloudinaryVideoMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Cloudinary returned invalid video metadata.");
  }
  const resource = value as Record<string, unknown>;
  if (
    resource.public_id !== publicId ||
    typeof resource.resource_type !== "string" ||
    typeof resource.type !== "string" ||
    typeof resource.format !== "string" ||
    typeof resource.bytes !== "number" ||
    !Number.isSafeInteger(resource.bytes) ||
    typeof resource.secure_url !== "string"
  ) {
    throw new Error("Cloudinary returned invalid video metadata.");
  }

  return {
    publicId,
    resourceType: resource.resource_type,
    deliveryType: resource.type,
    format: resource.format.toLowerCase(),
    bytes: resource.bytes,
    secureUrl: resource.secure_url,
  };
}

export function createCloudinaryVideoStore(
  options: CloudinaryVideoStoreOptions = {},
): CloudinaryVideoStore {
  const config = options.config ?? getCloudinaryConfig();
  const client = configuredCloudinary(config);

  return {
    authorizeUpload(publicId, timestamp) {
      const signature = client.utils.api_sign_request(
        {
          overwrite: false,
          public_id: publicId,
          timestamp,
          type: "authenticated",
        },
        config.apiSecret,
      );
      return {
        uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/video/upload`,
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        publicId,
        timestamp,
        signature,
      };
    },

    async inspect(publicId) {
      const result: unknown = await client.api.resource(publicId, {
        resource_type: "video",
        type: "authenticated",
      });
      return readMetadata(result, publicId);
    },

    createSignedDownloadUrl(publicId, format, expiresInSeconds = 5 * 60) {
      return client.utils.private_download_url(publicId, format, {
        resource_type: "video",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
      });
    },

    async delete(publicId) {
      const result = (await client.uploader.destroy(publicId, {
        resource_type: "video",
        type: "authenticated",
        invalidate: true,
      })) as { result?: string };
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error("Cloudinary video cleanup failed.");
      }
    },
  };
}
