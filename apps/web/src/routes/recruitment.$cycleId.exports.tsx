import { canDecidePlacement } from "@labrador/access-control";
import { createFileRoute } from "@tanstack/react-router";
import { Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
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
import { type CsvColumn, csvFilename, downloadCsv, toCsv } from "@/lib/csv.ts";
import {
  type DecisionExportRow,
  formatStatistic,
  type RankingExportRow,
  type ReviewerLoadExportRow,
  yearLabel,
} from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/exports")({
  component: ExportsPage,
});

/** How many rows the on-screen preview shows before it stops and says so. */
const PREVIEW_LIMIT = 10;

/*
 * One column list per export, shared by the on-screen table and the CSV, so a
 * preview can never show a different set of columns from the file it downloads.
 */

const RANKING_COLUMNS: ReadonlyArray<CsvColumn<RankingExportRow>> = [
  { header: "Rank", value: (row) => row.rank },
  { header: "Tied", value: (row) => (row.tied ? "yes" : "no") },
  { header: "Applicant", value: (row) => row.applicantName },
  { header: "Email", value: (row) => row.email },
  { header: "Year", value: (row) => yearLabel(row.year) },
  { header: "Major", value: (row) => row.major },
  { header: "Committee", value: (row) => row.committee },
  { header: "Applicant preference", value: (row) => row.applicantRank },
  { header: "Submitted reviews", value: (row) => row.submittedReviews },
  { header: "Minimum reviews", value: (row) => row.minimumReviews },
  { header: "Mean", value: (row) => row.mean },
  { header: "Median", value: (row) => row.median },
  { header: "Spread", value: (row) => row.spread },
  { header: "Standard deviation", value: (row) => row.standardDeviation },
  { header: "Strong Yes", value: (row) => row.strongYes },
  { header: "Yes", value: (row) => row.yes },
  { header: "Unsure", value: (row) => row.unsure },
  { header: "No", value: (row) => row.no },
  { header: "Strong No", value: (row) => row.strongNo },
  { header: "Flagged", value: (row) => (row.flagged ? "yes" : "no") },
  { header: "Flag reasons", value: (row) => row.flagReasons },
  { header: "Decision", value: (row) => row.decision },
];

const DECISION_COLUMNS: ReadonlyArray<CsvColumn<DecisionExportRow>> = [
  { header: "Applicant", value: (row) => row.applicantName },
  { header: "Email", value: (row) => row.email },
  { header: "Year", value: (row) => yearLabel(row.year) },
  { header: "Committee", value: (row) => row.committee },
  { header: "Applicant preference", value: (row) => row.applicantRank },
  { header: "Committee decision", value: (row) => row.committeeDecision },
  { header: "Decision notes", value: (row) => row.decisionNotes },
  { header: "Final placement", value: (row) => row.finalPlacement },
  { header: "Placed committee", value: (row) => row.placedCommittee },
];

const REVIEWER_LOAD_COLUMNS: ReadonlyArray<CsvColumn<ReviewerLoadExportRow>> = [
  { header: "Reviewer", value: (row) => row.reviewerName },
  { header: "Reviewer user id", value: (row) => row.reviewerUserId },
  { header: "Role", value: (row) => row.role },
  { header: "Committee", value: (row) => row.committee },
  { header: "Assigned", value: (row) => row.assigned },
  { header: "Submitted", value: (row) => row.submitted },
  { header: "Conflicted", value: (row) => row.conflicted },
  { header: "Outstanding", value: (row) => row.outstanding },
];

function ExportsPage() {
  const { cycleId } = Route.useParams();
  const { user, isLoaded, isLeadership } = useRecruitmentUser(cycleId);
  const mayExportCycleWide = canDecidePlacement({ user });

  const [selected, setSelected] = useState("");

  const cycles = $api.useQuery("get", "/recruitment/cycles");
  const cycleSlug = (cycles.data ?? []).find((cycle) => cycle.id === cycleId)?.slug ?? "cycle";

  const committees = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees",
    { params: { path: { cycleId } } },
    { enabled: isLeadership },
  );

  const committeeList = committees.data ?? [];
  const committeeId = selected === "" ? (committeeList[0]?.id ?? "") : selected;
  const committeeSlug = committeeList.find((item) => item.id === committeeId)?.slug ?? "committee";

  const ranking = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/exports/committees/{committeeId}/ranking",
    { params: { path: { cycleId, committeeId } } },
    { enabled: isLeadership && committeeId !== "" },
  );

  const decisions = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/exports/decisions",
    { params: { path: { cycleId } } },
    { enabled: mayExportCycleWide },
  );

  const reviewerLoad = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/exports/reviewer-load",
    { params: { path: { cycleId } } },
    { enabled: mayExportCycleWide },
  );

  if (isLoaded && !isLeadership) {
    return (
      <EmptyState title="Exports are for committee leads and recruitment admins">
        <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          A ranking export lists every candidacy in a committee alongside applicant contact details,
          so it is available to the people who hold aggregate visibility rather than to every
          reviewer. Ask a committee lead or recruitment admin if you need a copy.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Exports</h2>
        <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
          Each export is previewed here before you download it, so nothing reaches a spreadsheet
          unseen. Every column is submitted application data or arithmetic over scores a named human
          entered.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Which of these is safe to circulate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm leading-6">
          <p className="flex max-w-[80ch] items-start gap-2">
            <ShieldAlert className="mt-1 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Committee ranking</span> and{" "}
              <span className="font-medium">decisions</span> contain applicant PII — names, emails,
              and in the decisions export the notes written about them. Keep these two off shared
              drives and out of group chats.
            </span>
          </p>
          <p className="flex max-w-[80ch] items-start gap-2">
            <ShieldCheck className="mt-1 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Reviewer load</span> contains no applicant data at all —
              only reviewers and counts. That is the one to circulate when the conversation is about
              coverage rather than about people.
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Committee ranking</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
            One row per candidacy in the chosen committee, with the arithmetic beside it. Contains
            applicant PII.
          </p>
          <CommitteePicker
            id="export-committee"
            committees={committeeList}
            value={committeeId}
            onChange={setSelected}
          />
          {committees.isError ? (
            <ErrorState title="Could not load committees" error={committees.error} />
          ) : committeeId === "" && !committees.isLoading ? (
            <EmptyState
              title="No committees configured"
              description="A recruitment admin configures committees before a ranking exists."
            />
          ) : ranking.isError ? (
            <ErrorState title="Could not load the ranking export" error={ranking.error} />
          ) : ranking.isLoading || committees.isLoading ? (
            <TableSkeleton columns={RANKING_COLUMNS.slice(0, 6).map((column) => column.header)} />
          ) : (
            <ExportSection
              caption="Committee ranking export"
              columns={RANKING_COLUMNS}
              rows={ranking.data ?? []}
              filename={csvFilename(cycleSlug, committeeSlug, "ranking")}
              emptyMessage="This committee has no candidacies to export yet."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decisions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
            Every committee decision and final placement in the cycle. Contains applicant PII,
            including the notes leadership wrote during discussion.
          </p>
          {!mayExportCycleWide ? (
            <p className="text-sm leading-6">
              Only a recruitment admin can export decisions, because the file spans every committee
              in the cycle rather than the one you lead.
            </p>
          ) : decisions.isError ? (
            <ErrorState title="Could not load the decisions export" error={decisions.error} />
          ) : decisions.isLoading ? (
            <TableSkeleton columns={DECISION_COLUMNS.map((column) => column.header)} />
          ) : (
            <ExportSection
              caption="Decisions export"
              columns={DECISION_COLUMNS}
              rows={decisions.data ?? []}
              filename={csvFilename(cycleSlug, "decisions")}
              emptyMessage="No decision has been recorded in this cycle yet."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewer load</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
            Assigned, submitted, conflicted, and outstanding counts per reviewer. No applicant
            appears in this file, so it is the safe one to share when discussing coverage.
          </p>
          {!mayExportCycleWide ? (
            <p className="text-sm leading-6">
              Only a recruitment admin can export reviewer load, because it covers every reviewer in
              the cycle.
            </p>
          ) : reviewerLoad.isError ? (
            <ErrorState
              title="Could not load the reviewer-load export"
              error={reviewerLoad.error}
            />
          ) : reviewerLoad.isLoading ? (
            <TableSkeleton columns={REVIEWER_LOAD_COLUMNS.map((column) => column.header)} />
          ) : (
            <ExportSection
              caption="Reviewer load export"
              columns={REVIEWER_LOAD_COLUMNS}
              rows={reviewerLoad.data ?? []}
              filename={csvFilename(cycleSlug, "reviewer-load")}
              emptyMessage="No reviewer has been enrolled in this cycle yet."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ExportSectionProps<Row> {
  caption: string;
  columns: ReadonlyArray<CsvColumn<Row>>;
  rows: readonly Row[];
  filename: string;
  emptyMessage: string;
}

function ExportSection<Row>({
  caption,
  columns,
  rows,
  filename,
  emptyMessage,
}: ExportSectionProps<Row>) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const shown = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length === shown.length
            ? `${rows.length} row${rows.length === 1 ? "" : "s"}.`
            : `Showing the first ${shown.length} of ${rows.length} rows. The download contains all of them.`}
        </p>
        <Button
          onClick={() => {
            downloadCsv(filename, toCsv(columns, rows));
          }}
        >
          <Download aria-hidden /> Download CSV
        </Button>
      </div>
      <Table>
        <caption className="mb-2 text-left text-sm text-muted-foreground">
          {caption} — {filename}
        </caption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.header} scope="col">
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column.header}>{renderCell(column.value(row))}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Preview cells restate what the CSV will hold. A missing value shows an em dash
 * rather than the empty string the file carries, so a blank column reads as
 * absent data on screen instead of as a rendering fault.
 */
function renderCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : formatStatistic(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}
