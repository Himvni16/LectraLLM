import type { UploadLimits } from "@/lib/env";

const VIDEO_MIME_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  ".mp4": ["video/mp4"],
  ".mov": ["video/quicktime", "video/mov", "video/x-quicktime"],
  ".webm": ["video/webm"],
};

const PDF_MIME_TYPES = new Set(["application/pdf"]);

export type UploadErrorCode =
  | "INVALID_FORM_DATA"
  | "MISSING_VIDEO"
  | "MISSING_PDF"
  | "MULTIPLE_VIDEO_FILES"
  | "MULTIPLE_PDF_FILES"
  | "EMPTY_VIDEO"
  | "EMPTY_PDF"
  | "INVALID_VIDEO_TYPE"
  | "INVALID_PDF_TYPE"
  | "VIDEO_TOO_LARGE"
  | "PDF_TOO_LARGE";

export class UploadRequestError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export interface UploadPair {
  video: File;
  pdf: File;
}

export interface ValidatedUploadFile {
  file: File;
  originalFileName: string;
  extension: string;
}

export interface ValidatedUploadPair {
  video: ValidatedUploadFile;
  pdf: ValidatedUploadFile;
}

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : "";
}

export function sanitizeOriginalFileName(fileName: string): string {
  const leafName = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const cleaned = leafName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  if (!cleaned) {
    return "uploaded-file";
  }

  if (cleaned.length <= 255) {
    return cleaned;
  }

  const extension = fileExtension(cleaned);
  const preservedExtension = extension.length <= 10 ? extension : "";
  return `${cleaned.slice(0, 255 - preservedExtension.length)}${preservedExtension}`;
}

function requireSingleFile(
  formData: FormData,
  fieldName: "video" | "pdf",
): File {
  const entries = formData.getAll(fieldName);
  const label = fieldName === "video" ? "lecture video" : "lecture PDF";
  const upperFieldName = fieldName.toUpperCase();

  if (entries.length === 0) {
    throw new UploadRequestError(
      `MISSING_${upperFieldName}` as UploadErrorCode,
      `A ${label} is required.`,
    );
  }

  if (entries.length !== 1) {
    throw new UploadRequestError(
      `MULTIPLE_${upperFieldName}_FILES` as UploadErrorCode,
      `Submit exactly one ${label}.`,
    );
  }

  const entry = entries[0];

  if (!(entry instanceof File)) {
    throw new UploadRequestError(
      `MISSING_${upperFieldName}` as UploadErrorCode,
      `A ${label} is required.`,
    );
  }

  return entry;
}

export function parseUploadFormData(formData: FormData): UploadPair {
  return {
    video: requireSingleFile(formData, "video"),
    pdf: requireSingleFile(formData, "pdf"),
  };
}

function validateVideo(file: File, limits: UploadLimits): ValidatedUploadFile {
  if (file.size === 0) {
    throw new UploadRequestError("EMPTY_VIDEO", "The lecture video is empty.");
  }

  if (file.size > limits.videoMaxSizeBytes) {
    throw new UploadRequestError(
      "VIDEO_TOO_LARGE",
      `The lecture video exceeds the ${limits.videoMaxSizeMb} MB limit.`,
      413,
    );
  }

  const originalFileName = sanitizeOriginalFileName(file.name);
  const extension = fileExtension(originalFileName);
  const allowedMimeTypes = VIDEO_MIME_TYPES_BY_EXTENSION[extension];
  const mimeType = file.type.trim().toLowerCase();

  if (!allowedMimeTypes || (mimeType && !allowedMimeTypes.includes(mimeType))) {
    throw new UploadRequestError(
      "INVALID_VIDEO_TYPE",
      "The lecture video must be an MP4, MOV, or WebM file.",
    );
  }

  return { file, originalFileName, extension };
}

function validatePdf(file: File, limits: UploadLimits): ValidatedUploadFile {
  if (file.size === 0) {
    throw new UploadRequestError("EMPTY_PDF", "The lecture PDF is empty.");
  }

  if (file.size > limits.pdfMaxSizeBytes) {
    throw new UploadRequestError(
      "PDF_TOO_LARGE",
      `The lecture PDF exceeds the ${limits.pdfMaxSizeMb} MB limit.`,
      413,
    );
  }

  const originalFileName = sanitizeOriginalFileName(file.name);
  const extension = fileExtension(originalFileName);
  const mimeType = file.type.trim().toLowerCase();

  if (extension !== ".pdf" || (mimeType && !PDF_MIME_TYPES.has(mimeType))) {
    throw new UploadRequestError(
      "INVALID_PDF_TYPE",
      "The lecture document must be a PDF file.",
    );
  }

  return { file, originalFileName, extension };
}

export function validateUploadPair(
  upload: UploadPair,
  limits: UploadLimits,
): ValidatedUploadPair {
  return {
    video: validateVideo(upload.video, limits),
    pdf: validatePdf(upload.pdf, limits),
  };
}
