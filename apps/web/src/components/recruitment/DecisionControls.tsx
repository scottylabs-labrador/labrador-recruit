import { useState } from "react";

import { Button } from "@/components/ui/button";

export type DecisionValue = "accept" | "waitlist" | "reject";

const LABELS: Record<DecisionValue, string> = {
  accept: "Admit",
  waitlist: "Waitlist",
  reject: "Reject",
};

/** How a recorded decision reads once it exists. */
export function DecisionBadge({ status }: { status: string }) {
  if (status === "pending") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const tone =
    status === "accept"
      ? "bg-emerald-100 text-emerald-900"
      : status === "reject"
        ? "bg-rose-100 text-rose-900"
        : "bg-amber-100 text-amber-900";

  return (
    <span className={`rounded-[6px] px-2 py-0.5 text-xs font-medium ${tone}`}>
      {LABELS[status as DecisionValue] ?? status}
    </span>
  );
}

interface DecisionControlsProps {
  applicantLabel: string;
  decisionStatus: string;
  /** How many reviews short of the cycle's minimum this candidacy is. */
  reviewsShortBy: number;
  busy: boolean;
  onDecide: (status: DecisionValue) => void;
}

/**
 * Admit, waitlist or reject one candidacy.
 *
 * Deciding before the cycle's review minimum is met is allowed — sometimes a
 * committee already knows — but it is confirmed rather than silent, and the
 * confirmation names how many reviews are missing. Admitting somebody nobody
 * has read is a reasonable thing to do occasionally and a terrible thing to do
 * without noticing.
 */
export function DecisionControls({
  applicantLabel,
  decisionStatus,
  reviewsShortBy,
  busy,
  onDecide,
}: DecisionControlsProps) {
  const [confirming, setConfirming] = useState<DecisionValue | null>(null);

  function request(status: DecisionValue) {
    if (reviewsShortBy > 0) {
      setConfirming(status);
      return;
    }
    onDecide(status);
  }

  if (confirming !== null) {
    const reviews = reviewsShortBy === 1 ? "review" : "reviews";
    return (
      <div className="flex flex-col items-end gap-1.5">
        <p className="text-xs leading-5 text-muted-foreground">
          {`${applicantLabel} is ${reviewsShortBy} ${reviews} short of this cycle's minimum. `}
          {`${LABELS[confirming]} anyway?`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              onDecide(confirming);
              setConfirming(null);
            }}
          >
            {`Yes, ${LABELS[confirming].toLowerCase()}`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {(["accept", "waitlist", "reject"] as const).map((status) => (
        <Button
          key={status}
          size="sm"
          variant={decisionStatus === status ? "default" : "outline"}
          disabled={busy}
          onClick={() => request(status)}
        >
          {LABELS[status]}
          <span className="sr-only">{` ${applicantLabel}`}</span>
        </Button>
      ))}
    </div>
  );
}
