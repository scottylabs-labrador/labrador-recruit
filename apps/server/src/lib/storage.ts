import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "../env.ts";
import type { FileStorage } from "./fileStorage.ts";
import { LocalFileStorage } from "./fileStorage.ts";
import { R2FileStorage } from "./r2Storage.ts";

/**
 * The storage the application uses, chosen once at boot.
 *
 * R2 when it is configured, the local filesystem adapter otherwise — and the
 * fallback is **refused in production**. A deployment silently serving
 * applicant resumes off its own container disk, where they vanish on the next
 * deploy, is a worse outcome than failing to start, and it is the kind of
 * thing nobody notices until somebody asks for a file back.
 *
 * The R2 adapter is written and selected whenever all four `R2_*` variables
 * are set. What is still missing is the **bucket** — `#11` has not provisioned
 * one — and therefore the one test only a real bucket makes possible: fetching
 * an object key directly and being denied. Everything in front of storage is
 * exercised against the port by the local adapter, which is why that is the
 * only gap rather than the whole feature.
 */
function build(): FileStorage {
  const r2Configured =
    env.R2_ACCOUNT_ID !== undefined &&
    env.R2_ACCESS_KEY_ID !== undefined &&
    env.R2_SECRET_ACCESS_KEY !== undefined &&
    env.R2_BUCKET !== undefined;

  if (r2Configured) {
    return new R2FileStorage({
      accountId: env.R2_ACCOUNT_ID as string,
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
      bucket: env.R2_BUCKET as string,
    });
  }

  /*
   * Fail closed: the local adapter needs an explicit opt-in.
   *
   * The first version of this guard threw only when `NODE_ENV === "production"`,
   * which is backwards. An unset or misspelled `NODE_ENV` is an ordinary
   * deployment mistake - `#11` records two variables that have already gone
   * wrong exactly that way on Railway - and inferring "not production" from
   * its absence means a real deployment silently stores applicant resumes on a
   * container disk, signed with whatever secret was lying around, and loses
   * them on the next deploy. Nobody notices until somebody asks for a file
   * back.
   *
   * So the question is no longer "is this production" but "did somebody say
   * this is allowed".
   */
  if (env.ALLOW_LOCAL_FILE_STORAGE !== "on") {
    throw new Error(
      "No object storage is configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET — or set ALLOW_LOCAL_FILE_STORAGE=on to use the filesystem adapter, which is for development only and loses every upload on redeploy.",
    );
  }

  return new LocalFileStorage({
    root: env.FILE_STORAGE_ROOT ?? join(tmpdir(), "recruit-uploads"),
    // The adapter's URLs point at this API, because in development it serves
    // the bytes itself. R2 is the whole reason that is temporary.
    publicBaseUrl: env.SERVER_URL,
    /*
     * A random secret per boot when none is configured.
     *
     * Better than a published default in every respect that matters: nothing
     * in the repository can forge a signature, and the only cost is that URLs
     * issued before a restart stop working - which for a fifteen-minute upload
     * window in development is not a cost at all.
     */
    secret: env.FILE_STORAGE_SECRET ?? randomBytes(32).toString("base64url"),
  });
}

export const storage: FileStorage = build();

/** The local adapter, when that is what is in use. Null under R2. */
export const localStorage: LocalFileStorage | null =
  storage instanceof LocalFileStorage ? storage : null;
