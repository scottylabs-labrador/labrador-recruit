import { useState } from "react";

import type { DecisionValue } from "@/components/recruitment/DecisionControls.tsx";
import { Button } from "@/components/ui/button";

const LABELS: Record<DecisionValue, string> = {
  accept: "Admit",
  waitlist: "Waitlist",
  reject: "Reject",
};

export interface BulkProgress {
  done: number;
  total: number;
  failed: number;
}

interface BulkDecisionBarProps {
  selectedCount: number;
  /** How many of the selected rows are short of the cycle's review minimum. */
  shortCount: number;
  progress: BulkProgress | null;
  busy: boolean;
  onApply: (status: DecisionValue) => void;
  onClear: () => void;
}

/**
 * Records one decision across a selection.
 *
 * Each candidacy is still written individually, so each remains an audited act
 * by the named person who pressed the button. That is also why the progress and
 * the failures are reported honestly: a bulk action that half-succeeded must
 * say so rather than leaving the reader to guess which rows took.
 */
export function BulkDecisionBar({
  selectedCount,
  shortCount,
  progress,
  busy,
  onApply,
  onClear,
}: BulkDecisionBarProps) {
  const [confirming, setConfirming] = useState<DecisionValue | null>(null);

  if (selectedCount === 0 && progress === null) {
    return null;
  }

  function request(status: DecisionValue) {
    if (shortCount > 0) {
      setConfirming(status);
      return;
    }
    onApply(status);
  }

  if (progress !== null && (busy || progress.failed > 0)) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-muted/40 px-4 py-3"
      >
        <span className="text-sm">
          {busy
            ? `Recording ${progress.done} of ${progress.total}…`
            : `Recorded ${progress.done - progress.failed} of ${progress.total}.`}
        </span>
        {!busy && progress.failed > 0 ? (
          <span className="text-sm font-medium text-destructive">
            {progress.failed} could not be recorded and were left unchanged.
          </span>
        ) : null}
        {!busy ? (
          <Button size="sm" variant="outline" onClick={onClear}>
            Dismiss
          </Button>
        ) : null}
      </div>
    );
  }

  if (confirming !== null) {
    const rows = shortCount === 1 ? "candidacy is" : "candidacies are";
    return (
      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted/40 px-4 py-3">
        <p className="text-sm leading-6">
          {`${shortCount} of the ${selectedCount} selected ${rows} short of this cycle's review `}
          {`minimum. ${LABELS[confirming]} all ${selectedCount} anyway?`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onApply(confirming);
              setConfirming(null);
            }}
          >
            {`Yes, ${LABELS[confirming].toLowerCase()} ${selectedCount}`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-muted/40 px-4 py-3">
      <span className="text-sm font-medium">
        {selectedCount} selected
        {shortCount > 0 ? (
          <span className="font-normal text-muted-foreground">
            {` · ${shortCount} short of the review minimum`}
          </span>
        ) : null}
      </span>
      <div className="flex flex-wrap gap-2">
        {(["accept", "waitlist", "reject"] as const).map((status) => (
          <Button key={status} size="sm" variant="outline" onClick={() => request(status)}>
            {`${LABELS[status]} selected`}
          </Button>
        ))}
      </div>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
