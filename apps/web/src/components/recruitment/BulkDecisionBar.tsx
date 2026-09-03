import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label, Select } from "@/components/ui/field.tsx";
import {
  type DecisionStatus,
  DECISION_OPTIONS,
  decisionBadgeVariant,
  decisionLabel,
  isDecisionStatus,
} from "@/lib/recruitment.ts";

export interface BulkDecisionTarget {
  candidacyId: string;
  applicantName: string;
  currentStatus: string | null;
}

interface BulkDecisionBarProps {
  targets: readonly BulkDecisionTarget[];
  onClear: () => void;
  onApply: (status: DecisionStatus) => void;
  isPending: boolean;
  failures: readonly string[];
}

/**
 * Applies one committee decision to several candidacies at once.
 *
 * This is the deliberate shape of the "admit everyone above the line" request.
 * `docs/product-rules.md` §1 forbids "making an automatic accept or reject
 * decision, including by numeric cutoff", so nothing here derives an outcome:
 * a person selects the rows, is shown every applicant the change would touch
 * and what it would change them from, and confirms. The tool does the tedious
 * part; the judgement stays with the human, and the server records each outcome
 * against their name.
 *
 * The confirmation step is not a courtesy prompt. It is the point at which the
 * decision becomes a human one, so it always lists the applicants by name
 * rather than only their count.
 */
export function BulkDecisionBar({
  targets,
  onClear,
  onApply,
  isPending,
  failures,
}: BulkDecisionBarProps) {
  const [status, setStatus] = useState<DecisionStatus>("accept");
  const [confirming, setConfirming] = useState(false);

  if (targets.length === 0) return null;

  const changing = targets.filter((target) => (target.currentStatus ?? "pending") !== status);
  const unchanged = targets.length - changing.length;

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm font-medium tabular-nums">
          {targets.length} {targets.length === 1 ? "applicant selected" : "applicants selected"}
        </p>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bulk-decision-status">Set decision to</Label>
            <Select
              id="bulk-decision-status"
              className="w-44"
              value={status}
              disabled={isPending}
              onChange={(event) => {
                const next = event.target.value;
                if (isDecisionStatus(next)) {
                  setStatus(next);
                  setConfirming(false);
                }
              }}
            >
              {DECISION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {confirming ? null : (
            <Button onClick={() => setConfirming(true)} disabled={isPending}>
              Review {changing.length} {changing.length === 1 ? "change" : "changes"}
            </Button>
          )}
          <Button variant="outline" onClick={onClear} disabled={isPending}>
            <X aria-hidden /> Clear selection
          </Button>
        </div>
      </div>

      {confirming ? (
        <div className="mt-4 rounded-lg border border-border bg-background p-4">
          {changing.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Every selected applicant is already set to {decisionLabel(status)}. There is nothing
              to apply.
            </p>
          ) : (
            <>
              <h3 className="text-sm font-semibold">
                Set {changing.length} {changing.length === 1 ? "applicant" : "applicants"} to{" "}
                {decisionLabel(status)}
              </h3>
              <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
                This records your name against each outcome below. It is a committee proposal, not a
                final placement — leadership still places each applicant separately.
                {unchanged > 0 ? (
                  <>
                    {" "}
                    <span className="tabular-nums">{unchanged}</span> selected{" "}
                    {unchanged === 1 ? "applicant is" : "applicants are"} already set to{" "}
                    {decisionLabel(status)} and will be left alone.
                  </>
                ) : null}
              </p>

              <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm leading-6">
                {changing.map((target) => (
                  <li key={target.candidacyId} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{target.applicantName}</span>
                    <Badge variant={decisionBadgeVariant(target.currentStatus)}>
                      {decisionLabel(target.currentStatus)}
                    </Badge>
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                    <span className="sr-only">becomes</span>
                    <Badge variant={decisionBadgeVariant(status)}>{decisionLabel(status)}</Badge>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => onApply(status)} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  Confirm {changing.length} {changing.length === 1 ? "decision" : "decisions"}
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={isPending}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {failures.length} {failures.length === 1 ? "decision" : "decisions"} could not be saved
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6 text-muted-foreground">
            {failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
