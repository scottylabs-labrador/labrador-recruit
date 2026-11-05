/**
 * What a file actually is, as opposed to what it claims.
 *
 * The declared MIME type on an upload is a string the browser sent, which
 * means it is a string an attacker sent. A `.pdf` that is a Windows executable
 * declares `application/pdf` just as convincingly as a real one.
 *
 * **This is not malware scanning and must never be described as such** — not
 * in the code, not in the docs, and not to the committee. It answers one
 * question: are these bytes the format they claim to be. A perfectly
 * well-formed PDF carrying something nasty passes every check here. See the
 * `scanFile` hook in `fileService.ts` and `docs/product-rules.md`.
 */

/**
 * The only types an applicant may upload.
 *
 * Enumerated rather than open, so adding one is a decision somebody makes on
 * purpose and a reviewer can see in a diff.
 *
 * **No `.docx`,** deliberately. A `.docx` is a zip container, so accepting one
 * means accepting an archive whose contents are unexamined — including a
 * macro-enabled document, which is a live malware vector that this MVP has
 * nothing to catch. Asking an applicant for a PDF costs them a menu click and
 * removes the entire class.
 */
export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/**
 * A signature, which is always a **prefix**.
 *
 * Never a search. Finding `%PDF-` eight bytes into a file means somebody put
 * it there, and treating that as a PDF is precisely the bypass this exists to
 * close.
 */
const SIGNATURES: readonly { type: AllowedUploadType; magic: readonly number[] }[] = [
  { type: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG's fourth byte varies by variant (JFIF, Exif, raw), so only the first
  // three are the signature.
  { type: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
];

/** How many bytes a caller needs to read for `sniffFileType` to decide. */
export const SNIFF_BYTES = 16;

/**
 * The type these bytes are, or null.
 *
 * Null is a refusal, not an "unknown to be allowed through". Every caller
 * treats it as a rejection — a file whose format we cannot name is a file we
 * will not store for a reviewer to open.
 */
export function sniffFileType(bytes: Uint8Array): AllowedUploadType | null {
  for (const { type, magic } of SIGNATURES) {
    if (bytes.length < magic.length) {
      continue;
    }
    if (magic.every((byte, index) => bytes[index] === byte)) {
      return type;
    }
  }
  return null;
}
