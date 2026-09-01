import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Label, Select } from "@/components/ui/field.tsx";
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
  formatRank,
  isQueueStatus,
  QUEUE_STATUS_OPTIONS,
  queueStatusLabel,
  type QueueItem,
  type QueueStatus,
  yearLabel,
} from "@/lib/recruitment.ts";

const COLUMNS = ["Committee", "Applicant", "Year", "Major", "Their rank", "Review", ""];

export const Route = createFileRoute("/recruitment/$cycleId/queue")({
  component: MyQueuePage,
});

function MyQueuePage() {
  const { cycleId } = Route.useParams();
  const [committeeFilter, setCommitteeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatus | "">("");

  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });

  const query: { status?: string; committeeId?: string } = {};
  if (statusFilter !== "") query.status = statusFilter;
  if (committeeFilter !== "") query.committeeId = committeeFilter;

  const queue = $api.useQuery("get", "/recruitment/cycles/{cycleId}/my-queue", {
    params: { path: { cycleId }, query },
  });

  const committeeList = committees.data ?? [];
  const items = queue.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">My Review Queue</h2>
          <p className="text-sm text-muted-foreground">
            Reviews assigned to you in this cycle. Each row is one applicant for one committee.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="queue-committee-filter">Committee</Label>
            <Select
              id="queue-committee-filter"
              className="w-48"
              value={committeeFilter}
              onChange={(event) => setCommitteeFilter(event.target.value)}
            >
              <option value="">All committees</option>
              {committeeList.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="queue-status-filter">Status</Label>
            <Select
              id="queue-status-filter"
              className="w-40"
              value={statusFilter}
              onChange={(event) => {
                const next = event.target.value;
                setStatusFilter(isQueueStatus(next) ? next : "");
              }}
            >
              <option value="">All statuses</option>
              {QUEUE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {queue.isError ? (
        <ErrorState title="Could not load your review queue" error={queue.error} />
      ) : queue.isLoading ? (
        <TableSkeleton columns={COLUMNS} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing in your queue"
          description={
            committeeFilter === "" && statusFilter === ""
              ? "You have no review assignments in this cycle. A committee lead or recruitment admin assigns reviewers."
              : "No assignments match these filters. Clear a filter to see the rest of your queue."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column, index) => (
                <TableHead key={column === "" ? `action-${index}` : column}>
                  {column === "" ? <span className="sr-only">Actions</span> : column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.assignmentId}>
                <TableCell>{item.committeeName}</TableCell>
                <TableCell className="font-medium">{applicantLabel(item.applicantName)}</TableCell>
                <TableCell>{yearLabel(item.year)}</TableCell>
                <TableCell className="max-w-56 truncate">{item.major ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{formatRank(item.applicantRank)}</TableCell>
                <TableCell>
                  <QueueStatusBadge item={item} />
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    to="/recruitment/$cycleId/review/$assignmentId"
                    params={{ cycleId, assignmentId: item.assignmentId }}
                    className="rounded-md px-1 font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Open
                    <span className="sr-only">
                      {` review of ${applicantLabel(item.applicantName)} for ${item.committeeName}`}
                    </span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function QueueStatusBadge({ item }: { item: QueueItem }) {
  const label = queueStatusLabel(item);
  if (label === "Submitted") return <Badge variant="success">{label}</Badge>;
  if (label === "Conflicted") return <Badge variant="warning">{label}</Badge>;
  if (label === "Draft") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="muted">{label}</Badge>;
}
