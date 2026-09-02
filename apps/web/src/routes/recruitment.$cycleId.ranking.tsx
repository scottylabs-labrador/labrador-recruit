import { createFileRoute, Link } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { useState } from "react";

import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
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

  const rows = ranking.data ?? [];

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
        <TableSkeleton columns={COLUMNS} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to rank yet"
          description="A ranking appears once candidacies exist and reviewers have submitted reviews."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const complete = row.submittedCount >= row.minimumReviews;
              return (
                <TableRow key={row.candidacyId}>
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
                </TableRow>
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
