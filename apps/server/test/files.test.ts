/**
 * Applicant file uploads.
 *
 * Three-step flow: the backend authorizes and presigns, the browser PUTs
 * straight to storage, the backend validates and commits. The tests are
 * ordered by what goes wrong if each one is missing — a file somebody else
 * owns being attachable is worse than an over-size upload being accepted, and
 * both are worse than a confusing error message.
 *
 * **Nothing here is malware scanning.** The commit path answers "are these
 * bytes the format they claim" and nothing more, and `#21` says plainly that
 * the MVP does not scan. A well-formed PDF carrying something nasty passes.
 */
import { file, recruitmentCycle, team, user } from "@recruit/db/schema";
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app.ts";
import { LocalFileStorage } from "../src/lib/fileStorage.ts";
import { localStorage, storage } from "../src/lib/storage.ts";
import { seedApplicant } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const now = new Date();
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const PDF_BYTES = (() => {
  const bytes = new Uint8Array(1024);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
  return bytes;
})();

const EXECUTABLE_BYTES = (() => {
  const bytes = new Uint8Array(1024);
  bytes.set([0x4d, 0x5a], 0);
  return bytes;
})();

beforeEach(async () => {
  await testDb.insert(user).values({
    id: "dchen",
    name: "Dana Chen",
    email: "dchen@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
  await testDb.insert(recruitmentCycle).values({
    slug: "spring-2027",
    name: "Spring 2027",
    status: "open",
    opensAt: past,
    createdBy: "dchen",
    createdAt: now,
    updatedAt: now,
  });
  await testDb
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now });
});

/** Runs the whole browser side of the flow: ask, PUT, and return the file id. */
async function upload(
  headers: Record<string, string>,
  opts: { bytes?: Uint8Array; mimeType?: string; filename?: string } = {},
) {
  const bytes = opts.bytes ?? PDF_BYTES;
  const res = await request(app)
    .post("/v1/files")
    .set(headers)
    .send({
      originalFilename: opts.filename ?? "resume.pdf",
      mimeType: opts.mimeType ?? "application/pdf",
      sizeBytes: bytes.byteLength,
    });

  if (res.status === 201) {
    const [row] = await testDb
      .select({ objectKey: file.objectKey })
      .from(file)
      .where(eq(file.id, res.body.fileId));
    // Stands in for the browser's PUT to the presigned URL. The bytes never
    // pass through the API in production; here the adapter is the disk.
    await localStorage!.put(row!.objectKey, bytes);
  }

  return res;
}

describe("asking for somewhere to upload", () => {
  it("returns a file id and a short-lived upload url", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await upload(applicant.headers);

    expect(res.status).toBe(201);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.uploadUrl).toContain("http");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("records the file as pending, never usable yet", async () => {
    const applicant = await seedApplicant("aquinn");

    await upload(applicant.headers);

    const [row] = await testDb.select().from(file);
    // A `pending` row is what makes an abandoned upload harmless: submission
    // refuses anything that is not `committed`.
    expect(row!.status).toBe("pending");
    expect(row!.committedAt).toBeNull();
    expect(row!.ownerUserId).toBe("aquinn");
  });

  it("generates an opaque key and never derives one from the filename", async () => {
    const applicant = await seedApplicant("aquinn");

    await upload(applicant.headers, { filename: "../../etc/passwd" });

    const [row] = await testDb.select().from(file);
    /*
     * A filename is attacker input and a key is a path.
     *
     * The filename is kept verbatim for display, because it is what the
     * applicant called their file and a reviewer should see that — but it
     * appears nowhere in the key.
     */
    expect(row!.originalFilename).toBe("../../etc/passwd");
    expect(row!.objectKey).not.toContain("passwd");
    expect(row!.objectKey).not.toContain("..");
  });

  it("refuses a type that is not on the allow-list", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .post("/v1/files")
      .set(applicant.headers)
      .send({ originalFilename: "resume.docx", mimeType: "application/zip", sizeBytes: 1024 });

    // Refused before anything is stored, so an unsupported type costs an
    // applicant a message rather than a wasted upload.
    expect(res.status).toBe(422);
    expect(await testDb.select().from(file)).toHaveLength(0);
  });

  it("refuses a declared size over the cap before the bytes are sent", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .post("/v1/files")
      .set(applicant.headers)
      .send({
        originalFilename: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500 * 1024 * 1024,
      });

    // The declared size is not trusted — commit re-checks the real one — but
    // refusing here saves somebody uploading 500MB to be told no afterwards.
    expect(res.status).toBe(422);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app)
      .post("/v1/files")
      .send({ originalFilename: "resume.pdf", mimeType: "application/pdf", sizeBytes: 1024 });

    expect(res.status).toBe(401);
  });
});

describe("committing an upload", () => {
  it("marks a well-formed file usable", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);

    const res = await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    expect(res.status).toBe(200);
    const [row] = await testDb.select().from(file);
    expect(row!.status).toBe("committed");
    expect(row!.committedAt).not.toBeNull();
    expect(row!.sizeBytes).toBe(PDF_BYTES.byteLength);
  });

  it("refuses a file whose bytes are not the type it declared", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers, { bytes: EXECUTABLE_BYTES });

    const res = await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    /*
     * The case `#21`'s definition of done names: a `.pdf` that is a PE binary.
     *
     * The declared type came from the browser, so it is a string an attacker
     * sent. The bytes are the only evidence.
     */
    expect(res.status).toBe(422);
    const [row] = await testDb.select().from(file);
    expect(row!.status).toBe("pending");
  });

  it("refuses a file whose stored bytes exceed the cap", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);
    const [row] = await testDb.select({ objectKey: file.objectKey }).from(file);
    // A presigned PUT cannot be trusted to have honoured the declared size, so
    // commit measures what is actually there.
    const oversize = new Uint8Array(11 * 1024 * 1024);
    oversize.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
    await localStorage!.put(row!.objectKey, oversize);

    const res = await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    expect(res.status).toBe(422);
    expect((await testDb.select().from(file))[0]!.status).toBe("pending");
  });

  it("refuses to commit a file that was never uploaded", async () => {
    const applicant = await seedApplicant("aquinn");
    const res = await request(app)
      .post("/v1/files")
      .set(applicant.headers)
      .send({ originalFilename: "resume.pdf", mimeType: "application/pdf", sizeBytes: 1024 });

    // No PUT happened. An abandoned upload is ordinary, so this is a clear
    // refusal rather than a server error.
    const commit = await request(app)
      .post(`/v1/files/${res.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    expect(commit.status).toBe(422);
  });

  it("never lets one applicant commit another's upload", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const created = await upload(owner.headers);

    const res = await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(other.headers)
      .send({});

    // 404, not 403: a 403 would confirm that somebody else's file exists,
    // which is the one thing an id-guesser must not learn.
    expect(res.status).toBe(404);
    expect((await testDb.select().from(file))[0]!.status).toBe("pending");
  });

  it("is idempotent, so a retried commit does not error", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);
    await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    const again = await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    // A lost response on a flaky connection is the common case, and a second
    // commit of the same file is the same act.
    expect(again.status).toBe(200);
  });
});

describe("downloading a file", () => {
  it("issues a short-lived url for the owner", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);
    await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    const res = await request(app)
      .get(`/v1/files/${created.body.fileId}/download`)
      .set(applicant.headers);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("http");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("never issues a url for somebody else's file", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const created = await upload(owner.headers);
    await request(app).post(`/v1/files/${created.body.fileId}/commit`).set(owner.headers).send({});

    const res = await request(app)
      .get(`/v1/files/${created.body.fileId}/download`)
      .set(other.headers);

    expect(res.status).toBe(404);
  });

  it("refuses a file that was never committed", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);

    const res = await request(app)
      .get(`/v1/files/${created.body.fileId}/download`)
      .set(applicant.headers);

    // A `pending` file has not been validated, so its bytes are whatever was
    // PUT. Serving them to anybody, including their owner, is the thing the
    // commit step exists to prevent.
    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);

    const res = await request(app).get(`/v1/files/${created.body.fileId}/download`);

    expect(res.status).toBe(401);
  });
});

describe("the upload url cannot be reused after commit", () => {
  it("leaves the committed bytes untouched when the same url is PUT again", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await request(app).post("/v1/files").set(applicant.headers).send({
      originalFilename: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });

    const [staged] = await testDb.select({ objectKey: file.objectKey }).from(file);
    await localStorage!.put(staged!.objectKey, PDF_BYTES);
    await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    /*
     * The bypass this closes.
     *
     * A presigned PUT is valid for fifteen minutes, and commit happens within
     * seconds of it. So the obvious attack is: upload a genuine PDF, let the
     * magic-byte check pass, then PUT a payload to the *same still-valid url*.
     * The row would still say `committed` with a validated MIME type, and a
     * reviewer would download whatever arrived second.
     *
     * The fix is that the presigned url only ever covered a **staging** key,
     * and commit copies the validated bytes to a final key the url does not
     * cover. Writing to staging afterwards changes nothing anybody reads.
     */
    await localStorage!.put(staged!.objectKey, EXECUTABLE_BYTES);

    const [row] = await testDb.select().from(file);
    expect(row!.status).toBe("committed");
    // The committed object is at a different key than the one the browser
    // could write to.
    expect(row!.objectKey).not.toBe(staged!.objectKey);

    const prefix = await localStorage!.readPrefix(row!.objectKey, 5);
    // Still the PDF that was validated, not the executable PUT afterwards.
    expect(Array.from(prefix!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  });

  it("refuses when the staged bytes change between validation and the copy", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);
    const [staged] = await testDb.select({ objectKey: file.objectKey }).from(file);

    /*
     * The race the first fix left open.
     *
     * Moving to a staging key shrank the window from fifteen minutes to
     * milliseconds, but the upload url is still live, so a re-PUT landing
     * between "read staging and validate" and "copy staging to final" puts an
     * executable at the *immutable* final key with the row marked validated.
     * Both requests belong to the attacker, so they can fire them together and
     * retry until it lands - which makes milliseconds a window, not a
     * rounding error.
     *
     * Overwriting staging inside `copy` reproduces that interleaving exactly
     * and deterministically. A real race is not reproducible against PGlite,
     * but this does not need one: the assertion is that validation reads the
     * object that will actually be served, not a mutable predecessor of it.
     */
    const copy = vi.spyOn(storage, "copy").mockImplementation(async (from, to) => {
      await localStorage!.put(from, EXECUTABLE_BYTES);
      await LocalFileStorage.prototype.copy.call(localStorage, from, to);
    });

    try {
      const res = await request(app)
        .post(`/v1/files/${created.body.fileId}/commit`)
        .set(applicant.headers)
        .send({});

      expect(res.status).toBe(422);
      const [row] = await testDb.select().from(file);
      expect(row!.status).toBe("pending");
      // And the object it would have been served from is gone, rather than
      // left behind for a later commit to find already in place.
      expect(row!.objectKey).toBe(staged!.objectKey);
    } finally {
      copy.mockRestore();
    }
  });

  it("presigns the upload against a staging key, never the final one", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await upload(applicant.headers);
    const [staged] = await testDb.select({ objectKey: file.objectKey }).from(file);
    expect(staged!.objectKey).toContain("staging/");

    await request(app)
      .post(`/v1/files/${created.body.fileId}/commit`)
      .set(applicant.headers)
      .send({});

    const [row] = await testDb.select({ objectKey: file.objectKey }).from(file);
    expect(row!.objectKey).not.toContain("staging/");
  });
});

describe("the object key is not a capability", () => {
  it("refuses a storage request with no signature", async () => {
    const applicant = await seedApplicant("aquinn");
    await upload(applicant.headers);
    const [row] = await testDb.select({ objectKey: file.objectKey }).from(file);

    const res = await request(app).get(
      `/__local-storage/get?key=${encodeURIComponent(row!.objectKey)}&exp=${Date.now() + 60_000}`,
    );

    /*
     * The whole premise of a private bucket.
     *
     * Knowing a key - and a reviewer who has ever downloaded a file knows one -
     * must get you nothing without a signature the backend issued for it. The
     * local adapter enforces this so that every test built on it is proving
     * the same property R2 will.
     */
    expect(res.status).toBe(403);
  });
});
