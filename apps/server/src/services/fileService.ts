import { randomUUID } from "node:crypto";

import { file } from "@recruit/db/schema";
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db.ts";
import type { AllowedUploadType } from "../lib/magicBytes.ts";
import { ALLOWED_UPLOAD_TYPES, SNIFF_BYTES, sniffFileType } from "../lib/magicBytes.ts";
import { storage } from "../lib/storage.ts";
import { NotFoundError, ValidationFailedError } from "../middlewares/errorHandler.ts";

/**
 * The largest upload accepted, in bytes.
 *
 * A resume is a few hundred kilobytes and a portfolio PDF rarely more than a
 * couple of megabytes. The cap is generous for both and small enough that a
 * careless applicant uploading a video gets told so immediately rather than
 * after ten minutes.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Long enough to pick a file and upload it on bad wifi; short enough to matter. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** Long enough to click and open. A download URL is handed out far more often. */
const DOWNLOAD_URL_TTL_SECONDS = 2 * 60;

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface DownloadTicket {
  url: string;
  expiresAt: string;
  originalFilename: string;
}

export interface CommittedFile {
  fileId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * The hook where malware scanning will go, and does not yet.
 *
 * **This does not scan for malware, and the MVP must never be described as
 * doing so** — not in the code, not in the docs, and not to the committee.
 * What it does is confirm the bytes are the format they claim and are within
 * the size cap. A perfectly well-formed PDF carrying something nasty passes
 * every check here and always will until something real is behind this
 * function.
 *
 * The hook exists rather than the checks being inlined so that adding a
 * ClamAV sidecar later is one implementation rather than a search through the
 * commit path. `#21` asks for the follow-up issue; the limitation is stated
 * here because this is where somebody will look.
 */
async function scanFile(opts: {
  prefix: Uint8Array;
  sizeBytes: number;
  declaredType: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (opts.sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit.`,
    };
  }

  const actual = sniffFileType(opts.prefix);
  if (actual === null) {
    return {
      ok: false,
      reason: "That file is not a PDF, PNG or JPEG. Please upload one of those.",
    };
  }
  if (actual !== opts.declaredType) {
    /*
     * The bytes win over the declaration, always.
     *
     * The declared type came from the browser, so it is a string an attacker
     * sent. The message deliberately does not say what the file "really is" —
     * that is information about our checks, and the applicant only needs to
     * know what to do.
     */
    return {
      ok: false,
      reason:
        "That file does not match the type it claims to be. Please upload a PDF, PNG or JPEG.",
    };
  }

  return { ok: true };
}

function isAllowedType(value: string): value is AllowedUploadType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value);
}

/**
 * Finds a file the caller owns, or 404.
 *
 * 404 rather than 403 for a file belonging to somebody else, identically to
 * one that never existed. A 403 would confirm the file exists, which is the
 * one thing an id-guesser must not be able to learn.
 */
async function ownedFile(userId: string, fileId: string) {
  // Checked before the query, because Postgres errors on a failed uuid cast —
  // turning a malformed request into a server fault.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
    throw new NotFoundError();
  }
  const [row] = await db
    .select()
    .from(file)
    .where(and(eq(file.id, fileId), eq(file.ownerUserId, userId)));
  if (!row) {
    throw new NotFoundError();
  }
  return row;
}

export const fileService = {
  /**
   * Authorizes an upload and hands back somewhere to put it.
   *
   * The declared size and type are checked here so an applicant is told no
   * before spending their upload, and **checked again at commit** against what
   * actually arrived — a presigned PUT cannot be relied on to have honoured
   * either.
   */
  createUpload: async (
    userId: string,
    input: { originalFilename: string; mimeType: string; sizeBytes: number },
  ): Promise<UploadTicket> => {
    if (!isAllowedType(input.mimeType)) {
      throw new ValidationFailedError(
        "That file type is not accepted. Please upload a PDF, PNG or JPEG.",
      );
    }
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new ValidationFailedError("That file appears to be empty.");
    }
    if (input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new ValidationFailedError(
        `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit.`,
      );
    }
    if (input.originalFilename.trim() === "") {
      throw new ValidationFailedError("That file has no name.");
    }

    /*
     * The key is generated and opaque. It is **never** derived from the
     * filename.
     *
     * A filename is attacker input and a key is a path. The filename is kept
     * verbatim for display, because it is what the applicant called their file
     * and a reviewer should see that — but it appears nowhere in the key and
     * is never joined to a path.
     *
     * **A staging key, not the final one.** The presigned PUT is valid for
     * fifteen minutes and commit happens within seconds of it, so a url that
     * covered the final key would let an applicant pass the magic-byte check
     * with a genuine PDF and then overwrite the object with anything while the
     * row still read `committed`. Commit copies the validated bytes to a final
     * key the browser never received a signature for.
     */
    const objectKey = `staging/${userId}/${randomUUID()}`;

    const [row] = await db
      .insert(file)
      .values({
        ownerUserId: userId,
        objectKey,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        // `pending` is what makes an abandoned upload harmless: submission
        // refuses anything that is not `committed`.
        status: "pending",
        createdAt: new Date(),
      })
      .returning({ id: file.id });

    const presigned = await storage.presignPut(objectKey, {
      contentType: input.mimeType,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      fileId: row!.id,
      uploadUrl: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  },

  /**
   * Validates what actually arrived, and makes the file usable.
   *
   * Idempotent: a lost response on a flaky connection is the common case, and
   * committing the same file twice is the same act.
   */
  commitUpload: async (userId: string, fileId: string): Promise<CommittedFile> => {
    const row = await ownedFile(userId, fileId);

    if (row.status === "committed") {
      return {
        fileId: row.id,
        originalFilename: row.originalFilename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      };
    }

    /*
     * Copy first, then validate the copy. **This order is the security
     * property, not a style choice.**
     *
     * The obvious order — read staging, validate, copy — is wrong, and was
     * wrong here through two rounds of fixing it. The presigned PUT stays
     * valid for its full fifteen minutes, so a re-PUT landing between the
     * validating read and the copy puts whatever the applicant likes at the
     * *immutable* final key, with the row marked validated. Staging to a
     * separate key shrank that window to milliseconds and did not close it:
     * both requests belong to the attacker, so they can fire them together
     * and retry until one lands.
     *
     * Copying first makes the bytes immutable — no signature was ever issued
     * for `finalKey`, so nothing can write to it — and validating afterwards
     * means the checks ran against the exact object that will be served.
     *
     * The general rule, which this flow has now taught three times: validate
     * the thing you are going to use, never a mutable predecessor of it.
     */
    const finalKey = `uploads/${userId}/${randomUUID()}`;
    try {
      await storage.copy(row.objectKey, finalKey);
    } catch {
      // Nothing was ever PUT. An abandoned upload is ordinary, so this is a
      // clear refusal rather than a server error.
      throw new ValidationFailedError(
        "That upload did not finish. Please choose the file and try again.",
      );
    }

    const head = await storage.head(finalKey);
    if (head === null) {
      // A copy that produced nothing. Not expected, so it is refused rather
      // than committed with a size of zero.
      await storage.delete(finalKey).catch(() => undefined);
      throw new ValidationFailedError(
        "That upload did not finish. Please choose the file and try again.",
      );
    }

    const prefix = await storage.readPrefix(finalKey, SNIFF_BYTES);
    const verdict = await scanFile({
      prefix: prefix ?? new Uint8Array(0),
      sizeBytes: head.sizeBytes,
      declaredType: row.mimeType,
    });

    if (!verdict.ok) {
      /*
       * The rejected copy is removed, and the row stays `pending`.
       *
       * Leaving the object behind would be worse than untidy: a later commit
       * generates a fresh `finalKey`, so this one would simply sit there
       * un-referenced — an applicant's rejected file kept in a bucket for no
       * reason anybody could later explain.
       */
      await storage.delete(finalKey).catch(() => undefined);
      throw new ValidationFailedError(verdict.reason);
    }

    const now = new Date();
    const committed = await db
      .update(file)
      .set({
        status: "committed",
        committedAt: now,
        sizeBytes: head.sizeBytes,
        objectKey: finalKey,
      })
      /*
       * The owner and the prior status are both in the predicate.
       *
       * Not only in the checks above: the read and this write are separate
       * statements, and the predicate is what makes the write itself incapable
       * of committing somebody else's file or re-committing one that moved on.
       */
      .where(and(eq(file.id, fileId), eq(file.ownerUserId, userId), eq(file.status, "pending")))
      .returning({ id: file.id });

    if (committed.length !== 1) {
      /*
       * The copy already happened, so the orphan is cleared.
       *
       * Leaving it would be a stored object nothing references — harmless to
       * read, because no row points at it, but it is still an applicant's file
       * sitting in a bucket for no reason.
       */
      await storage.delete(finalKey).catch(() => undefined);
      throw new ValidationFailedError(
        "That file changed while it was being checked. Please try again.",
      );
    }

    // Best effort, and deliberately after the row is committed. A staging
    // object that outlives its upload is waste; a committed row pointing at a
    // key we just deleted would be a broken download.
    await storage.delete(row.objectKey).catch(() => undefined);

    return {
      fileId: row.id,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: head.sizeBytes,
    };
  },

  /**
   * A short-lived URL for one file, for its owner.
   *
   * A `pending` file is refused even to the person who uploaded it: its bytes
   * are whatever was PUT and have not been validated, and serving them is
   * exactly what the commit step exists to prevent.
   *
   * TODO(#10): staff download is not here. A reviewer reading an applicant's
   * resume needs a grant and an assignment checked, which is the authorization
   * core's job — hand-writing that check here is what `AGENTS.md` section 3
   * forbids.
   */
  presignDownload: async (userId: string, fileId: string): Promise<DownloadTicket> => {
    const row = await ownedFile(userId, fileId);
    if (row.status !== "committed") {
      throw new NotFoundError();
    }

    const presigned = await storage.presignGet(row.objectKey, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      downloadFilename: row.originalFilename,
    });

    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      originalFilename: row.originalFilename,
    };
  },
};
