import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { apiFetch } from "@/lib/apiClient";

export interface FileUploaderProps {
  id: string;
  /** The committed file's id, or null. Never a pending one. */
  value: string | null;
  onChange: (fileId: string | null) => void;
  describedBy?: string;
  disabled?: boolean;
}

type Phase = "idle" | "asking" | "sending" | "committing";

/**
 * One file upload, as a control.
 *
 * Three network steps hide behind one click: the backend authorizes and
 * presigns, the browser PUTs the bytes straight to storage, and the backend
 * validates what arrived. The applicant sees none of that, so the two things
 * this component owes them are an honest progress state and a failure said out
 * loud rather than a control that merely looks finished.
 *
 * **The answer is set only after the commit succeeds.** An id recorded before
 * then is a reference that submission refuses, and the applicant would find
 * that out at the deadline rather than now.
 *
 * A native `<input type="file">`, so the browser's own picker, keyboard
 * handling and assistive-technology support come for free and correctly.
 */
export function FileUploader(props: FileUploaderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [filename, setFilename] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * Resolve the name of a file this session did not upload.
   *
   * A returning applicant's answer holds an id from last time. Without this
   * they would see a bare uuid and have no way to tell which file is attached
   * — or whether the right one is.
   */
  useEffect(() => {
    if (props.value === null) {
      setFilename(null);
      return;
    }
    let cancelled = false;
    void apiFetch
      .GET("/files/{fileId}/download", { params: { path: { fileId: props.value } } })
      .then(({ data }) => {
        if (!cancelled && data !== undefined) {
          setFilename(data.originalFilename);
        }
      })
      .catch(() => {
        // Leaves the name unknown rather than clearing the answer. The file is
        // still attached; we just cannot label it.
      });
    return () => {
      cancelled = true;
    };
  }, [props.value]);

  async function upload(chosen: File) {
    setFailure(null);
    setPhase("asking");

    const created = await apiFetch.POST("/files", {
      body: {
        originalFilename: chosen.name,
        mimeType: chosen.type,
        sizeBytes: chosen.size,
      },
    });
    if (created.data === undefined) {
      setPhase("idle");
      setFailure(messageFrom(created.error, "Could not start that upload. Please try again."));
      return;
    }

    setPhase("sending");
    try {
      /*
       * `fetch`, not the generated client.
       *
       * This URL is storage's, not ours — it is not in the API spec and must
       * not be, because a client written against it would break the moment
       * real R2 arrives. Bytes go browser-to-storage and never through the
       * API.
       */
      const put = await fetch(created.data.uploadUrl, {
        method: "PUT",
        body: chosen,
        headers: { "Content-Type": chosen.type },
      });
      if (!put.ok) {
        setPhase("idle");
        setFailure("Could not send that file. Check your connection and try again.");
        return;
      }
    } catch {
      setPhase("idle");
      setFailure("Could not send that file. Check your connection and try again.");
      return;
    }

    setPhase("committing");
    const committed = await apiFetch.POST("/files/{fileId}/commit", {
      params: { path: { fileId: created.data.fileId } },
    });
    setPhase("idle");

    if (committed.data === undefined) {
      /*
       * The server's own words.
       *
       * It checked the bytes and the browser cannot. "Upload failed" would
       * leave somebody retrying the same file forever, when what they need to
       * know is that it is not the format it claims.
       */
      setFailure(
        messageFrom(committed.error, "That file could not be accepted. Please try another."),
      );
      return;
    }

    setFilename(committed.data.originalFilename);
    props.onChange(committed.data.fileId);
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-2">
      {props.value === null ? (
        <>
          <input
            id={props.id}
            type="file"
            aria-label="Choose a file"
            aria-describedby={props.describedBy}
            disabled={props.disabled === true || busy}
            accept="application/pdf,image/png,image/jpeg"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen !== undefined) {
                void upload(chosen);
              }
            }}
          />
          <p className="text-xs text-muted-foreground">PDF, PNG or JPEG, up to 10MB.</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-border bg-card px-3 py-2">
          {/* Their filename, not our opaque id - it is what tells them the
              right file went up. */}
          <span className="text-sm font-medium">{filename ?? "Attached file"}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.disabled === true || busy}
            onClick={() => {
              setFilename(null);
              props.onChange(null);
            }}
          >
            Remove
          </Button>
        </div>
      )}

      {/*
        Announced, not merely drawn. Whether an upload finished is exactly what
        a spinner does not tell a screen reader.
      */}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {phase === "asking"
          ? "Preparing the upload…"
          : phase === "sending"
            ? "Sending the file…"
            : phase === "committing"
              ? "Checking the file…"
              : props.value === null
                ? ""
                : "File attached."}
      </p>

      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}

function messageFrom(error: unknown, fallback: string): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : fallback;
}

/**
 * A committed file, read-only.
 *
 * The answer stores an opaque file id, so the generic read-only answer path
 * showed an applicant a uuid on the one page whose whole job is reading back
 * what they sent. The name has to be fetched; the id is never shown, because
 * it is ours and means nothing to them.
 *
 * The download link is the presigned URL, requested when this renders. Those
 * URLs are deliberately short-lived, so the link is re-requested on every
 * render rather than cached — a stale one is a dead link on a page somebody
 * left open.
 */
export function ReadonlyFileAnswer({ fileId }: { fileId: string }) {
  const [ticket, setTicket] = useState<{ url: string; originalFilename: string } | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch
      .GET("/files/{fileId}/download", { params: { path: { fileId } } })
      .then(({ data }) => {
        if (cancelled) {
          return;
        }
        if (data !== undefined) {
          setTicket({ url: data.url, originalFilename: data.originalFilename });
        }
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) {
          setResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (ticket === null) {
    /*
     * The endpoint answers 404 for a file that is not the caller's or was
     * never committed. "A file is attached" is honest and useful; the id is
     * neither.
     */
    return (
      <p className="text-sm text-muted-foreground">
        {resolved ? "A file is attached." : "Loading the attached file…"}
      </p>
    );
  }

  return (
    <p className="text-sm">
      <span className="font-medium">{ticket.originalFilename}</span>{" "}
      <a href={ticket.url} className="ml-1 text-sm underline" rel="noreferrer">
        Download
      </a>
    </p>
  );
}
