import { createFileRoute, Link } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { Fragment, useState } from "react";

import { BulkDecisionBar, type BulkProgress } from "@/components/recruitment/BulkDecisionBar.tsx";
import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import {
  DecisionBadge,
  DecisionControls,
  type DecisionValue,
} from "@/components/recruitment/DecisionControls.tsx";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser";
import { useScopedCommittees } from "@/hooks/useScopedCommittees";
import { $api } from "@/lib/apiClient";
import {
  applicantLabel,
  countFor,
  formatRank,
  formatStatistic,
  RECOMMENDATION_OPTIONS,
} from "@/lib/recruitment.ts";

const COLUMNS = [
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

/**
 * The same columns wrapped in a selection box and the decision controls, for a
 * caller who may decide. Both ends are unlabelled, so the header reads as the
 * table's own columns rather than announcing two empty ones.
 */
const DECIDING_COLUMNS = ["", ...COLUMNS, ""];

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

  const committees = useScopedCommittees(cycleId);

  const committeeList = committees.committees;
  const committeeId = selected === "" ? committees.defaultCommitteeId : selected;
  const hasCommittee = committeeId !== "";

  // `RankingRow` now carries `minimumReviews` and `recommendationCounts`, so the
  // whole table comes from one request; there is no aggregate join left to do.
  const ranking = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/ranking",
    { params: { path: { cycleId, committeeId } } },
    { enabled: hasCommittee },
  );

  const rows = ranking.data ?? [];

  const { canDecideForCommittee } = useRecruitmentUser(cycleId);
  const canDecide = canDecideForCommittee(committeeId);
  const [deciding, setDeciding] = useState<string | null>(null);

  const decide = $api.useMutation("put", "/recruitment/candidacies/{candidacyId}/decision", {
    onSettled: () => {
      setDeciding(null);
      void ranking.refetch();
    },
  });

  function record(candidacyId: string, status: DecisionValue) {
    setDeciding(candidacyId);
    decide.mutate({
      params: { path: { candidacyId } },
      body: { status },
    });
  }

  const columns = canDecide ? DECIDING_COLUMNS : COLUMNS;

  // The cycle carries where leadership intends to draw the lines. They are
  // drawn on the table and offered as a selection; nothing is ever decided from
  // them, which product rule 1 requires.
  const cycle = $api.useQuery("get", "/recruitment/cycles/{cycleId}", {
    params: { path: { cycleId } },
  });
  const admitLine = cycle.data?.decisionCutoffAdmit ?? null;
  const rejectLine = cycle.data?.decisionCutoffReject ?? null;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [applying, setApplying] = useState(false);

  const selectedRows = rows.filter((row) => selectedIds.has(row.candidacyId));
  const shortCount = selectedRows.filter((row) => row.reviewsShortBy > 0).length;
  const allVisibleSelected = rows.length > 0 && selectedRows.length === rows.length;

  function toggle(candidacyId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidacyId)) {
        next.delete(candidacyId);
      } else {
        next.add(candidacyId);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(rows.map((row) => row.candidacyId)));
  }

  function selectAboveAdmitLine() {
    if (admitLine === null) return;
    setSelectedIds(
      new Set(rows.filter((row) => row.rank <= admitLine).map((row) => row.candidacyId)),
    );
  }

  /**
   * Writes one decision per candidacy rather than in a single call.
   *
   * Slower, and deliberately so: each write is its own audited act by the
   * person who pressed the button, and a failure part-way through leaves the
   * rows that succeeded recorded rather than rolling back work somebody meant
   * to do. The count of failures is reported instead of swallowed.
   */
  async function applyBulk(status: DecisionValue) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setApplying(true);
    setProgress({ done: 0, total: ids.length, failed: 0 });

    let failed = 0;
    for (const [index, candidacyId] of ids.entries()) {
      try {
        const recorded = await decide.mutateAsync({
          params: { path: { candidacyId } },
          body: { status },
        });
        // openapi-react-query only throws when the error body parses, so a
        // refusal that carries no body resolves as though it succeeded. The
        // endpoint answers with the decision it wrote, so a missing one means
        // nothing was written - counting that as success is precisely the
        // silent failure this screen must not have.
        if (recorded === undefined || recorded === null) {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      setProgress({ done: index + 1, total: ids.length, failed });
    }

    setApplying(false);
    setSelectedIds(new Set());
    void ranking.refetch();
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

      {canDecide && rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          {admitLine !== null ? (
            <div>
              <Button size="sm" variant="outline" onClick={selectAboveAdmitLine}>
                {`Select everyone above the admit line (rank ${admitLine})`}
              </Button>
            </div>
          ) : null}
          <BulkDecisionBar
            selectedCount={selectedRows.length}
            shortCount={shortCount}
            progress={progress}
            busy={applying}
            onApply={(status) => void applyBulk(status)}
            onClear={() => {
              setSelectedIds(new Set());
              setProgress(null);
            }}
          />
        </div>
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
                // Two columns are deliberately unlabelled, so the key cannot be
                // the label alone.
                <TableHead key={`${column}-${String(index)}`}>
                  {canDecide && index === 0 ? (
                    <Checkbox
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select every row shown"
                    />
                  ) : (
                    column
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const complete = row.submittedCount >= row.minimumReviews;
              const line =
                row.rank === admitLine
                  ? "Admit line"
                  : row.rank === rejectLine
                    ? "Reject line"
                    : null;
              return (
                <Fragment key={row.candidacyId}>
                  <TableRow>
                    {canDecide ? (
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(row.candidacyId)}
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
                    <TableCell>
                      <DecisionBadge status={row.decisionStatus} />
                    </TableCell>
                    {canDecide ? (
                      <TableCell className="text-right">
                        <DecisionControls
                          applicantLabel={applicantLabel(row.applicantName)}
                          decisionStatus={row.decisionStatus}
                          reviewsShortBy={row.reviewsShortBy}
                          busy={deciding === row.candidacyId}
                          onDecide={(status) => record(row.candidacyId, status)}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {line === null ? null : (
                    <TableRow aria-hidden={false}>
                      <TableCell colSpan={columns.length} className="p-0">
                        <div className="flex items-center gap-3 border-t-2 border-dashed border-primary/60 px-2 py-1">
                          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            {line}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
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
