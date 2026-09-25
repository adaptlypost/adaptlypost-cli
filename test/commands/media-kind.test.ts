import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  guessMimeType,
  maxBytesFor,
  sniffMimeType,
  unsupportedMediaHint,
  uploadFileName,
} from "../../src/commands/media-kind.js";

const head = (bytes: number[] | string): Buffer => {
  const start = typeof bytes === "string" ? Buffer.from(bytes, "latin1") : Buffer.from(bytes);
  return Buffer.concat([start, Buffer.alloc(12)]).subarray(0, 12);
};

const PDF = head("%PDF-1.7\n");
const OLE2 = head([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = head([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("sniffMimeType for documents", () => {
  it("reads a PDF from its %PDF- signature, whatever the name", () => {
    expect(sniffMimeType(PDF, "deck.pdf")).toBe("application/pdf");
    expect(sniffMimeType(PDF, "no-extension")).toBe("application/pdf");
    expect(sniffMimeType(PDF)).toBe("application/pdf");
  });

  it("picks PPTX or DOCX for a ZIP by the extension", () => {
    expect(sniffMimeType(ZIP, "deck.pptx")).toBe(PPTX);
    expect(sniffMimeType(ZIP, "/tmp/Report.DOCX")).toBe(DOCX);
  });

  it("refuses a ZIP without a .pptx or .docx extension", () => {
    expect(sniffMimeType(ZIP, "archive.zip")).toBeUndefined();
    expect(sniffMimeType(ZIP, "deck")).toBeUndefined();
    expect(sniffMimeType(ZIP)).toBeUndefined();
    expect(unsupportedMediaHint(ZIP)).toContain(".docx or .pptx");
  });

  it("picks PPT or DOC for an OLE2 file by the extension and refuses anything else", () => {
    expect(sniffMimeType(OLE2, "deck.ppt")).toBe("application/vnd.ms-powerpoint");
    expect(sniffMimeType(OLE2, "letter.doc")).toBe("application/msword");
    expect(sniffMimeType(OLE2, "sheet.xls")).toBeUndefined();
    expect(unsupportedMediaHint(OLE2)).toContain(".doc or .ppt");
  });

  it("does not let a document extension override image or video bytes", () => {
    expect(sniffMimeType(head([0xff, 0xd8, 0xff, 0xe0]), "photo.pdf")).toBe("image/jpeg");
    expect(sniffMimeType(head([0, 0, 0, 0x18, ...Buffer.from("ftypisom")]), "clip.docx")).toBe(
      "video/mp4",
    );
  });

  it("refuses bytes that only claim to be a PDF", () => {
    expect(sniffMimeType(head("%PDF"), "fake.pdf")).toBeUndefined();
    expect(unsupportedMediaHint(head("hello"))).toContain("PDF, PPT, PPTX, DOC or DOCX");
  });
});

describe("maxBytesFor", () => {
  it("caps documents at 100 MB beside the image and video limits", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(100 * 1024 * 1024);
    expect(maxBytesFor("application/pdf")).toBe(MAX_DOCUMENT_BYTES);
    expect(maxBytesFor(PPTX)).toBe(MAX_DOCUMENT_BYTES);
    expect(maxBytesFor("image/png")).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesFor("video/mp4")).toBe(MAX_VIDEO_BYTES);
  });
});

describe("uploadFileName", () => {
  it("keeps a document name that already carries its extension", () => {
    expect(uploadFileName("deck.pptx", PPTX)).toBe("deck.pptx");
    expect(uploadFileName("Deck.PDF", "application/pdf")).toBe("Deck.PDF");
  });

  it("appends .pdf to a PDF named without it, so the API can read the type", () => {
    expect(uploadFileName("report", "application/pdf")).toBe("report.pdf");
  });

  it("leaves images and videos alone", () => {
    expect(uploadFileName("photo", "image/jpeg")).toBe("photo");
  });
});

describe("guessMimeType", () => {
  it("reads a reference's kind from its extension, query strings aside", () => {
    expect(guessMimeType("https://cdn.example.com/deck.pdf?sig=1")).toBe("application/pdf");
    expect(guessMimeType("./notes.docx")).toBe(DOCX);
    expect(guessMimeType("clip.MOV")).toBe("video/mp4");
    expect(guessMimeType("https://cdn.example.com/a.jpg")).toBe("image/jpeg");
  });
});
