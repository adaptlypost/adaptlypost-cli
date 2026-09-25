import { extname } from "node:path";

import type { UploadMimeType } from "../api/types.js";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export const SNIFF_BYTES = 12;

export const DOCUMENT_MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const satisfies Record<string, UploadMimeType>;

type DocumentExtension = keyof typeof DOCUMENT_MIME_BY_EXTENSION;

const DOCUMENT_MIME_TYPES: readonly string[] = Object.values(DOCUMENT_MIME_BY_EXTENSION);

const PDF = Buffer.from("%PDF-", "latin1");
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const OLE2_EXTENSIONS: readonly DocumentExtension[] = [".doc", ".ppt"];
const ZIP_EXTENSIONS: readonly DocumentExtension[] = [".docx", ".pptx"];

const VIDEO_EXTENSION = /^\.(mp4|mov|m4v|qt)$/;
const IMAGE_EXTENSION = /^\.(jpe?g|png|webp)$/;

export const SUPPORTED_MEDIA =
  "JPEG, PNG, WebP, MP4, MOV, and for LinkedIn document posts PDF, PPT, PPTX, DOC or DOCX";

const startsWith = (head: Buffer, signature: Buffer): boolean =>
  head.length >= signature.length && head.subarray(0, signature.length).equals(signature);

/** Lower-cased extension of a path or URL, ignoring any query string or fragment. */
export const extensionOf = (reference: string): string =>
  extname(reference.replace(/[?#].*$/, "")).toLowerCase();

export const isDocumentMimeType = (mimeType: string): boolean =>
  DOCUMENT_MIME_TYPES.includes(mimeType);

const documentByExtension = (
  fileName: string,
  allowed: readonly DocumentExtension[],
): UploadMimeType | undefined => {
  const extension = extensionOf(fileName) as DocumentExtension;
  return allowed.includes(extension) ? DOCUMENT_MIME_BY_EXTENSION[extension] : undefined;
};

/**
 * Reads the MIME type from the first bytes of a file. OLE2 holds either a DOC or a PPT and a
 * ZIP either a DOCX or a PPTX; the bytes cannot tell the pair apart, so the file name's
 * extension picks one, and a container without a matching extension is not supported.
 */
export function sniffMimeType(head: Buffer, fileName = ""): UploadMimeType | undefined {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }

  if (startsWith(head, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString("latin1") === "RIFF" &&
    head.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    return head.subarray(8, 12).toString("latin1").startsWith("qt") ? "video/quicktime" : "video/mp4";
  }

  if (startsWith(head, PDF)) return "application/pdf";
  if (startsWith(head, OLE2)) return documentByExtension(fileName, OLE2_EXTENSIONS);
  if (startsWith(head, ZIP)) return documentByExtension(fileName, ZIP_EXTENSIONS);

  return undefined;
}

/** Explains why sniffMimeType gave up on a file, for the error hint. */
export function unsupportedMediaHint(head: Buffer): string {
  if (startsWith(head, OLE2)) {
    return "An Office 97-2003 file must end in .doc or .ppt; its bytes cannot tell the two apart";
  }
  if (startsWith(head, ZIP)) {
    return "A ZIP-based Office file must end in .docx or .pptx; its bytes cannot tell the two apart";
  }
  return `Supported: ${SUPPORTED_MEDIA}`;
}

export const maxBytesFor = (mimeType: UploadMimeType): number => {
  if (mimeType.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (isDocumentMimeType(mimeType)) return MAX_DOCUMENT_BYTES;
  return MAX_IMAGE_BYTES;
};

/**
 * The API reads a document's type from the extension of its stored URL, so a document's
 * upload name must carry the extension of its type. A PDF sniffed from a file named without
 * one gets ".pdf" appended; everything else keeps its name.
 */
export function uploadFileName(fileName: string, mimeType: UploadMimeType): string {
  if (!isDocumentMimeType(mimeType)) return fileName;

  const extension = extensionOf(fileName) as DocumentExtension;
  if (DOCUMENT_MIME_BY_EXTENSION[extension] === mimeType) return fileName;

  const canonical = (Object.keys(DOCUMENT_MIME_BY_EXTENSION) as DocumentExtension[]).find(
    (candidate) => DOCUMENT_MIME_BY_EXTENSION[candidate] === mimeType,
  );

  return `${fileName}${canonical ?? ""}`;
}

/** True when a reference's extension names an image or a video, so it cannot be a document. */
export const isImageOrVideoReference = (reference: string): boolean => {
  const extension = extensionOf(reference);
  return VIDEO_EXTENSION.test(extension) || IMAGE_EXTENSION.test(extension);
};

/** Best guess at a media reference's kind from its extension, for content-type inference. */
export function guessMimeType(reference: string): string {
  const extension = extensionOf(reference);
  if (VIDEO_EXTENSION.test(extension)) return "video/mp4";
  return DOCUMENT_MIME_BY_EXTENSION[extension as DocumentExtension] ?? "image/jpeg";
}
