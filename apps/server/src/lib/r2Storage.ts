import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { FileStorage, PresignedUrl } from "./fileStorage.ts";

export interface R2StorageOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Cloudflare R2, through its S3-compatible API.
 *
 * The bucket is **private**. Nothing is ever public-read: every access is a
 * presigned URL this backend issued after authorizing that specific caller for
 * that specific object, which is what makes an object key worthless on its own.
 *
 * `region: "auto"` and the account-scoped endpoint are R2's requirements rather
 * than choices. Signing is SigV4 all the same, so the S3 client works
 * unmodified — which is the whole reason #21 could be built against a port and
 * wired here afterwards.
 */
export class R2FileStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: R2StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async presignPut(
    key: string,
    opts: { contentType: string; expiresInSeconds: number },
  ): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: opts.contentType,
      }),
      { expiresIn: opts.expiresInSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  async presignGet(
    key: string,
    opts: { expiresInSeconds: number; downloadFilename: string },
  ): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        /*
         * `attachment`, always, and the filename is quoted with its own quotes
         * and backslashes removed.
         *
         * An applicant's upload must never render inline: the object is served
         * from a storage origin, so an accepted file that is really HTML would
         * run its script there. The commit path refuses HTML on magic bytes as
         * well — this is the second of the two, because one of them being
         * wrong should not be enough.
         */
        ResponseContentDisposition: `attachment; filename="${safeFilename(opts.downloadFilename)}"`,
        ResponseContentType: "application/octet-stream",
      }),
      { expiresIn: opts.expiresInSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch {
      // An abandoned upload — a `pending` row whose PUT never happened — is an
      // ordinary state to report rather than an error to throw.
      return null;
    }
  }

  async readPrefix(key: string, byteCount: number): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          /*
           * A ranged read, not the whole object.
           *
           * Commit needs sixteen bytes to sniff the format. Downloading a
           * ten-megabyte PDF into the API to look at its first five bytes
           * would be both slow and a waste of the bandwidth presigning exists
           * to avoid.
           */
          Range: `bytes=0-${byteCount - 1}`,
        }),
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes === undefined ? null : new Uint8Array(bytes);
    } catch {
      return null;
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    /*
     * A plain server-side copy, **not** a conditional one.
     *
     * `CopySourceIfMatch` on the ETag observed at validation time looks like a
     * tidier way to stop a staging object changing under us, and it is a
     * weaker one: it leaves validation reading the mutable source, and it
     * makes the guarantee depend on getting a header right rather than on the
     * destination being unwritable. `fileService` copies first and validates
     * the copy, which no signature was ever issued for. See the port's
     * `copy` doc and `f85d157`.
     */
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${fromKey}`,
        Key: toKey,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * A filename safe inside a quoted `Content-Disposition`.
 *
 * `replaceAll` rather than spreading the string: spreading iterates Unicode
 * code points and would reassemble an emoji in a filename as mojibake. The
 * applicant named their file; we remove only the two characters that could end
 * the quoting early and inject a second header parameter.
 */
function safeFilename(name: string): string {
  return name.replaceAll('"', "").replaceAll("\\", "");
}
