import { canDecideCommittee } from "@labrador/access-control";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { useState } from "react";

import {
  BulkDecisionBar,
  type BulkDecisionTarget,
} from "@/components/recruitment/BulkDecisionBar.tsx";
import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Checkbox, Select } from "@/components/ui/field.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import {
  applicantLabel,
  countFor,
  type DecisionStatus,
  DECISION_OPTIONS,
  decisionBadgeVariant,
  decisionLabel,
  formatDateTime,
  formatRank,
  formatStatistic,
  isDecisionStatus,
  RECOMMENDATION_OPTIONS,
} from "@/lib/recruitment.ts";

const BASE_COLUMNS = [
  "Rank",
  "Applicant",
  "Preference",
  "Reviews",
  "Mean",
  "Median",
  "Spread",
  "Recommendations",
  "Flags",
  "Status",
  "Decision",
];

const SHORT_RECOMMENDATION_LABELS: Record<string, string> = {
  strong_yes: "SY",
  yes: "Y",
  unsure: "U",
  no: "N",
  strong_no: "SN",
};

export const Route = createFileRoute("/recruitment/$cycleId/ranking")({
  component: RankingPage,
});

function RankingPage() {
  const { cycleId } = Route.useParams();
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<readonly string[]>([]);
  const [applying, setApplying] = useState(false);

  const standing = useRecruitmentUser(cycleId);

  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });

  const committeeList = committees.data ?? [];
  const committeeId = selected === "" ? (committeeList[0]?.id ?? "") : selected;
  const hasCommittee = committeeId !== "";

  // `RankingRow` now carries `minimumReviews` and `recommendationCounts`, so the
  // whole table comes from one request; there is no aggregate join left to do.
  const ranking = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/ranking",
    { params: { path: { cycleId, committeeId } } },
    { enabled: hasCommittee },
  );

  // Decisions come from their own endpoint rather than being joined onto
  // `RankingRow`, so the ranking query stays a pure ordering over review data.
  // It also carries the committee's capacity, which is the number a person
  // admitting people actually needs next to the button.
  const decisions = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/decisions",
    { params: { path: { cycleId, committeeId } } },
    { enabled: hasCommittee },
  );

  const setDecision = $api.useMutation("put", "/recruitment/candidacies/{candidacyId}/decision");

  const rows = ranking.data ?? [];
  const decisionRows = decisions.data?.decisions ?? [];
  const decisionByCandidacy = new Map(decisionRows.map((row) => [row.candidacyId, row]));

  function statusFor(candidacyId: string): string {
    return decisionByCandidacy.get(candidacyId)?.status ?? "pending";
  }

  // Evaluated per row with the same predicate the server uses, rather than
  // inferred from a role name here.
  const mayDecide =
    standing.isLoaded &&
    rows.some((row) =>
      canDecideCommittee({ user: standing.user, decision: { candidacyId: row.candidacyId } }),
    );

  const columns = mayDecide ? ["", ...BASE_COLUMNS] : BASE_COLUMNS;

  function toggle(candidacyId: string) {
    setFailures([]);
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(candidacyId)) next.delete(candidacyId);
      else next.add(candidacyId);
      return next;
    });
  }

  const targets: BulkDecisionTarget[] = rows
    .filter((row) => checked.has(row.candidacyId))
    .map((row) => ({
      candidacyId: row.candidacyId,
      applicantName: applicantLabel(row.applicantName),
      currentStatus: statusFor(row.candidacyId),
    }));

  async function applyOne(candidacyId: string, status: DecisionStatus, label: string) {
    try {
      await setDecision.mutateAsync({ params: { path: { candidacyId } }, body: { status } });
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "the server refused the change";
      return `${label}: ${detail}`;
    }
  }

  async function applyBulk(status: DecisionStatus) {
    setApplying(true);
    setFailures([]);

    // Applied one at a time against the existing single-decision endpoint so
    // each outcome gets its own audit event and its own author, exactly as a
    // decision made row by row would.
    const collected: string[] = [];
    for (const target of targets) {
      if ((target.currentStatus ?? "pending") === status) continue;
      const failure = await applyOne(target.candidacyId, status, target.applicantName);
      if (failure !== null) collected.push(failure);
    }

    setFailures(collected);
    setApplying(false);
    if (collected.length === 0) setChecked(new Set());
    await decisions.refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Committee ranking</h2>
          <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
            Ordered by arithmetic over submitted human reviews. Every figure here can be reproduced
            by hand from the reviews it summarises — there is no model in this path.
          </p>
        </div>
        <CommitteePicker
          id="ranking-committee"
          committees={committeeList}
          value={committeeId}
          onChange={setSelected}
        />
      </div>

      {mayDecide && decisions.data ? (
        <CapacityNote
          capacity={decisions.data.capacity}
          acceptedCount={decisions.data.acceptedCount}
          overCapacity={decisions.data.overCapacity}
        />
      ) : null}

      {mayDecide ? (
        <BulkDecisionBar
          targets={targets}
          onClear={() => {
            setChecked(new Set());
            setFailures([]);
          }}
          onApply={(status) => void applyBulk(status)}
          isPending={applying}
          failures={failures}
        />
      ) : null}

      {committees.isError ? (
        <ErrorState title="Could not load committees" error={committees.error} />
      ) : !hasCommittee && !committees.isLoading ? (
        <EmptyState
          title="No committees configured"
          description="A recruitment admin configures committees before a ranking exists."
        />
      ) : ranking.isError ? (
        <ErrorState title="Could not load the ranking" error={ranking.error} />
      ) : ranking.isLoading || committees.isLoading ? (
        <TableSkeleton columns={columns} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to rank yet"
          description="A ranking appears once candidacies exist and reviewers have submitted reviews."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={column === "" ? `select-${index}` : column}>
                  {column === "" ? <span className="sr-only">Select</span> : column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const complete = row.submittedCount >= row.minimumReviews;
              const decision = decisionByCandidacy.get(row.candidacyId);
              const status = statusFor(row.candidacyId);
              return (
                <TableRow key={row.candidacyId}>
                  {mayDecide ? (
                    <TableCell>
                      <Checkbox
                        checked={checked.has(row.candidacyId)}
                        disabled={applying}
                        onChange={() => toggle(row.candidacyId)}
                        aria-label={`Select ${applicantLabel(row.applicantName)}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="tabular-nums">
                    {row.rank}
                    {row.tied ? <span className="text-muted-foreground"> (tied)</span> : null}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to="/recruitment/$cycleId/applicant/$applicationId"
                      params={{ cycleId, applicationId: row.applicationId }}
                      className="rounded-md text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {applicantLabel(row.applicantName)}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatRank(row.applicantRank)}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.submittedCount}/{row.minimumReviews}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatStatistic(row.mean)}</TableCell>
                  <TableCell className="tabular-nums">{formatStatistic(row.median)}</TableCell>
                  <TableCell className="tabular-nums">{formatStatistic(row.spread)}</TableCell>
                  <TableCell>
                    <RecommendationDistribution counts={row.recommendationCounts} />
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    {row.flagged ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="warning">
                          <Flag aria-hidden /> Flagged
                        </Badge>
                        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-sm leading-6">
                          {row.reasons.length === 0 ? (
                            <li className="list-none pl-0 text-muted-foreground">
                              No reason was recorded for this flag.
                            </li>
                          ) : (
                            row.reasons.map((reason) => <li key={reason}>{reason}</li>)
                          )}
                        </ul>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {complete ? (
                      <Badge variant="success">Complete</Badge>
                    ) : (
                      <Badge variant="muted">
                        {Math.max(0, row.minimumReviews - row.submittedCount)} more needed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {mayDecide ? (
                      <div className="flex flex-col gap-1">
                        <Select
                          className="w-36"
                          value={status}
                          disabled={applying}
                          aria-label={`Decision for ${applicantLabel(row.applicantName)}`}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (!isDecisionStatus(next)) return;
                            setFailures([]);
                            void applyOne(
                              row.candidacyId,
                              next,
                              applicantLabel(row.applicantName),
                            ).then(async (failure) => {
                              if (failure !== null) setFailures([failure]);
                              await decisions.refetch();
                            });
                          }}
                        >
                          {DECISION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                        {decision?.decidedBy ? (
                          <span className="text-sm leading-5 text-muted-foreground">
                            {decision.decidedBy} · {formatDateTime(decision.decidedAt)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <Badge variant={decisionBadgeVariant(status)}>{decisionLabel(status)}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * The committee's capacity against how many it has proposed accepting.
 *
 * Stated rather than enforced. Going over capacity is a conversation for the
 * committee to have, not something the interface should refuse — and a cap that
 * silently blocked an admission would be the numeric cutoff product rule §1
 * forbids, wearing a different hat.
 */
function CapacityNote({
  capacity,
  acceptedCount,
  overCapacity,
}: {
  capacity: number | null;
  acceptedCount: number;
  overCapacity: boolean;
}) {
  if (capacity === null) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        <span className="tabular-nums">{acceptedCount}</span> proposed for admission. This committee
        has no configured capacity.
      </p>
    );
  }

  return (
    <p
      className={
        overCapacity
          ? "text-sm leading-6 text-destructive"
          : "text-sm leading-6 text-muted-foreground"
      }
    >
      <span className="tabular-nums">{acceptedCount}</span> of{" "}
      <span className="tabular-nums">{capacity}</span> places proposed for admission.
      {overCapacity ? " That is over this committee's capacity." : null}
    </p>
  );
}

function RecommendationDistribution({ counts }: { counts: Record<string, number> }) {
  const entries = RECOMMENDATION_OPTIONS.map((option) => ({
    label: option.label,
    short: SHORT_RECOMMENDATION_LABELS[option.value] ?? option.value,
    count: countFor(counts, option.value),
  })).filter((entry) => entry.count > 0);

  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="flex flex-wrap gap-1">
      {entries.map((entry) => (
        <Badge key={entry.short} variant="outline" title={`${entry.label}: ${entry.count}`}>
          <span aria-hidden>{entry.short}</span>
          <span className="sr-only">{entry.label}</span>
          <span className="tabular-nums"> {entry.count}</span>
        </Badge>
      ))}
    </span>
  );
}
