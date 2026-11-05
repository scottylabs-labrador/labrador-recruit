import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { formatTimestamp } from "@/lib/formatDate.ts";

/** The only statuses an applicant is ever shown. Nothing internal reaches here. */
export type ApplicantStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Interview"
  | "Decision Available"
  | "Withdrawn";

export interface ApplicationCardProps {
  applicationId: string;
  committeeName: string;
  committeeSlug: string;
  status: ApplicantStatus;
  lastSavedAt: string | null;
  submittedAt: string | null;
  onWithdraw: (applicationId: string) => void;
  isWithdrawing: boolean;
}

/**
 * Statuses from which an applicant may withdraw.
 *
 * Mirrors `WITHDRAWABLE_BEFORE_RELEASE` and `WITHDRAWABLE_AFTER_RELEASE` in
 * `applicationService.ts`, which is the authority — this list exists so the
 * page does not offer a button whose only outcome is a refusal. `Withdrawn` is
 * absent because it is already done, and `Decision Available` because
 * withdrawing after reading a decision is not withdrawing from consideration.
 *
 * If the server ever disagrees with this list, the server wins and the user
 * sees its message. That is the correct failure direction.
 */
const WITHDRAWABLE: readonly ApplicantStatus[] = [
  "Draft",
  "Submitted",
  "Under Review",
  "Interview",
];

/**
 * The badge tone per status.
 *
 * `Decision Available` is deliberately neutral rather than `success`. A
 * released decision may be a rejection, and a green badge would tell somebody
 * the outcome before they open it.
 */
function statusTone(status: ApplicantStatus): "muted" | "danger" | "success" | "default" {
  switch (status) {
    case "Draft":
      return "muted";
    case "Withdrawn":
      return "danger";
    case "Submitted":
      return "success";
    default:
      return "default";
  }
}

/**
 * One application on the dashboard.
 *
 * Withdrawing asks twice, inline. It is the one irreversible thing on this
 * page, and a single mis-click next to Continue would discard work somebody
 * spent an evening on. The confirmation is rendered in the page rather than in
 * a `window.confirm`, which is both unstyleable and unreadable to a screen
 * reader in the way a focused region is not.
 */
export function ApplicationCard(props: ApplicationCardProps) {
  const [confirming, setConfirming] = useState(false);
  const headingId = `application-${props.applicationId}`;
  const isDraft = props.status === "Draft";

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col rounded-[10px] border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="text-base font-semibold">
          {props.committeeName}
        </h3>
        <Badge variant={statusTone(props.status)}>{props.status}</Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {props.submittedAt === null
          ? props.lastSavedAt === null
            ? "Not started yet"
            : `Last saved ${formatTimestamp(props.lastSavedAt)}`
          : `Submitted ${formatTimestamp(props.submittedAt)}`}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {isDraft ? (
          <Link
            to="/app/apply/$teamSlug"
            params={{ teamSlug: props.committeeSlug }}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Continue
          </Link>
        ) : (
          <Link
            to="/app/submissions/$applicationId"
            params={{ applicationId: props.applicationId }}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium"
          >
            View
          </Link>
        )}

        {WITHDRAWABLE.includes(props.status) ? (
          confirming ? null : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Withdraw
            </Button>
          )
        ) : null}
      </div>

      {confirming ? (
        <div
          role="group"
          aria-labelledby={`${headingId}-confirm`}
          className="mt-4 rounded-[8px] border border-destructive/40 bg-destructive/5 p-4"
        >
          <p id={`${headingId}-confirm`} className="text-sm font-medium">
            Withdraw your application to {props.committeeName}?
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isDraft
              ? "Your draft stays readable, but the committee will not consider it. You cannot undo this."
              : "The committee will stop considering your application. You cannot undo this."}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={props.isWithdrawing}
              onClick={() => props.onWithdraw(props.applicationId)}
            >
              {props.isWithdrawing ? "Withdrawing…" : "Yes, withdraw it"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep my application
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
