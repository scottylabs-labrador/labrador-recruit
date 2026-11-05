import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "../env.ts";
import type { FileStorage } from "./fileStorage.ts";
import { LocalFileStorage } from "./fileStorage.ts";

/**
 * The storage the application uses, chosen once at boot.
 *
 * R2 when it is configured, the local filesystem adapter otherwise — and the
 * fallback is **refused in production**. A deployment silently serving
 * applicant resumes off its own container disk, where they vanish on the next
 * deploy, is a worse outcome than failing to start, and it is the kind of
 * thing nobody notices until somebody asks for a file back.
 *
 * TODO(#21): the R2 adapter itself is not written yet — `#11` has not
 * provisioned a bucket, so there is nothing to write it against. Everything in
 * front of this (presign, commit, magic bytes, size cap, ownership, expiry) is
 * built and tested against the port, so the remaining work is one adapter and
 * the one test a real bucket makes possible: fetching an object key directly
 * and being denied.
 */
function build(): FileStorage {
  const r2Configured =
    env.R2_ACCOUNT_ID !== undefined &&
    env.R2_ACCESS_KEY_ID !== undefined &&
    env.R2_SECRET_ACCESS_KEY !== undefined &&
    env.R2_BUCKET !== undefined;

  if (r2Configured) {
    throw new Error(
      "R2 is configured but the R2 storage adapter is not implemented yet — see #21. Unset the R2_* variables to use local storage.",
    );
  }

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "No object storage is configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET — the local filesystem adapter is for development only and loses every upload on redeploy.",
    );
  }

  return new LocalFileStorage({
    root: env.FILE_STORAGE_ROOT ?? join(tmpdir(), "recruit-uploads"),
    // The adapter's URLs point at this API, because in development it serves
    // the bytes itself. R2 is the whole reason that is temporary.
    publicBaseUrl: env.SERVER_URL,
    secret: env.FILE_STORAGE_SECRET,
  });
}

export const storage: FileStorage = build();

/** The local adapter, when that is what is in use. Null under R2. */
export const localStorage: LocalFileStorage | null =
  storage instanceof LocalFileStorage ? storage : null;
