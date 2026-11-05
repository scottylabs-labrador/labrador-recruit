/**
 * Magic-byte sniffing for uploads.
 *
 * The declared MIME type on an upload is a string the browser sent, which
 * means it is a string an attacker sent. These tests are about the gap between
 * what a file says it is and what it actually is, because that gap is the only
 * thing standing between a private bucket and somebody serving a payload out
 * of it to a reviewer.
 *
 * **This is not malware scanning and must never be described as such.** It
 * answers "are these bytes the format they claim", nothing more. A perfectly
 * well-formed PDF carrying something nasty passes every check here.
 */
import { describe, expect, it } from "vitest";

import { ALLOWED_UPLOAD_TYPES, sniffFileType } from "../src/lib/magicBytes.ts";

/** Builds a buffer that starts with `prefix` and is padded to a plausible size. */
function withPrefix(prefix: number[], length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(prefix, 0);
  return bytes;
}

const PDF = withPrefix([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PNG = withPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = withPrefix([0xff, 0xd8, 0xff, 0xe0]);
const ZIP = withPrefix([0x50, 0x4b, 0x03, 0x04]); // also .docx, .xlsx, .jar
const PE = withPrefix([0x4d, 0x5a]); // a Windows executable
const ELF = withPrefix([0x7f, 0x45, 0x4c, 0x46]);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

describe("sniffFileType", () => {
  it("recognises a PDF", () => {
    expect(sniffFileType(PDF)).toBe("application/pdf");
  });

  it("recognises a PNG", () => {
    expect(sniffFileType(PNG)).toBe("image/png");
  });

  it("recognises a JPEG", () => {
    expect(sniffFileType(JPEG)).toBe("image/jpeg");
  });

  it("does not recognise a Windows executable as anything", () => {
    // The case the definition of done names: a `.pdf` that is a PE binary.
    expect(sniffFileType(PE)).toBeNull();
  });

  it("does not recognise an ELF binary as anything", () => {
    expect(sniffFileType(ELF)).toBeNull();
  });

  it("does not recognise HTML as anything", () => {
    /*
     * HTML is the one that matters most for a *private* bucket.
     *
     * A download is served from a presigned URL on our own storage origin. An
     * HTML file accepted as a "portfolio" and then opened by a reviewer runs
     * its script wherever that origin sits, which is why this is a refusal
     * rather than a stored type.
     */
    expect(sniffFileType(HTML)).toBeNull();
  });

  it("does not recognise a zip, which is what a .docx is", () => {
    /*
     * Deliberate, and a product decision worth arguing with rather than
     * discovering.
     *
     * A `.docx` is a zip container, so accepting one means accepting an
     * archive whose contents are unexamined — including a macro-enabled
     * document, which is a live malware vector and this MVP has **no malware
     * scanning**. Asking for a PDF is a small cost to an applicant and removes
     * the whole class.
     */
    expect(sniffFileType(ZIP)).toBeNull();
  });

  it("returns null for an empty file rather than guessing", () => {
    expect(sniffFileType(new Uint8Array(0))).toBeNull();
  });

  it("returns null for bytes shorter than any signature", () => {
    expect(sniffFileType(new Uint8Array([0x25]))).toBeNull();
  });

  it("does not match a signature that appears later in the file", () => {
    // A signature is a prefix. Finding `%PDF-` at offset 8 means somebody put
    // it there, and treating that as a PDF is exactly the bypass this exists
    // to close.
    const hidden = new Uint8Array(64);
    hidden.set([0x4d, 0x5a], 0);
    hidden.set([0x25, 0x50, 0x44, 0x46, 0x2d], 8);

    expect(sniffFileType(hidden)).toBeNull();
  });
});

describe("the allow-list", () => {
  it("is exactly the three types an applicant may upload", () => {
    // Enumerated rather than open, so adding a type is a decision somebody
    // makes on purpose and a reviewer can see in a diff.
    expect([...ALLOWED_UPLOAD_TYPES].sort()).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
  });
});
