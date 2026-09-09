import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Label, Select } from "@/components/ui/field.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser";
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

const COLUMNS = ["Priority", "Committee", "Applicant", "Year", "Major", "Their rank", "Review", ""];

/**
 * Why this row is where it is.
 *
 * The queue is ordered rather than arbitrary, and an order whose reason is
 * invisible reads as arbitrary - which is the fastest way to get reviewers to
 * ignore it and work top to bottom anyway.
 */
function PriorityCell({
  tier,
  hasCommitteeResponse,
}: {
  tier: number;
  hasCommitteeResponse: boolean;
}) {
  if (tier <= 3) {
    return (
      <span
        className="text-sm font-medium tabular-nums"
        title={`Ranked this committee #${tier} and answered its questions`}
      >
        {`#${tier} + wrote`}
      </span>
    );
  }

  return (
    <span
      className="text-sm text-muted-foreground"
      title={
        hasCommitteeResponse
          ? "Answered this committee's questions but ranked it below third"
          : "Did not answer this committee's questions"
      }
    >
      {hasCommitteeResponse ? "wrote" : "no response"}
    </span>
  );
}

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

  const navigate = useNavigate();
  const [exhausted, setExhausted] = useState(false);

  /**
   * Takes the next applicant rather than waiting to be given one.
   *
   * Work is claimed, not allotted, so a reviewer who gets through applications
   * faster simply takes more of them. A 204 means the cycle has nothing left
   * for this reviewer - everything in their committees either has enough
   * reviews already or is one they hold - which is an ordinary end state and
   * is reported as such rather than as a failure.
   */
  /**
   * How much the team has left, not how much this reviewer has.
   *
   * Work is claimed rather than allotted, so a personal queue length says
   * nothing useful about whether the cycle is nearly done. What a reviewer
   * actually wants to know before deciding to read one more is how many
   * applicants still have nobody on them.
   */
  const teamProgress = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/review-progress",
    { params: { path: { cycleId } } },
    {
      /**
       * Several people review at once, so the number on screen is somebody
       * else's work as much as your own. Refetching on an interval and
       * whenever the tab regains focus keeps it honest without anybody
       * reloading: coming back from submitting a review shows the count that
       * review moved.
       */
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      refetchOnMount: "always",
    },
  );

  const claimNext = $api.useMutation("post", "/recruitment/cycles/{cycleId}/next-review", {
    onSuccess: (data) => {
      if (!data) {
        setExhausted(true);
        return;
      }
      void navigate({
        to: "/recruitment/$cycleId/review/$assignmentId",
        params: { cycleId, assignmentId: data.assignmentId },
      });
    },
  });

  const queue = $api.useQuery("get", "/recruitment/cycles/{cycleId}/my-queue", {
    params: { path: { cycleId }, query },
  });

  const standing = useRecruitmentUser(cycleId);
  const committeeList = committees.data ?? [];
  /**
   * A reviewer gets one thing to do; leadership gets the instrument panel.
   *
   * The filters and the table are for somebody auditing coverage, not for
   * somebody reading the next application - and offering them to a reviewer
   * turns "read one" into "choose which one", which is precisely the decision
   * the claim endpoint exists to take away.
   */
  const showQueueTools = standing.isLeadership;

  const items = queue.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Review Applications</h2>
          <p className="text-sm text-muted-foreground">
            Take the next applicant whenever you are ready. Nobody is allotted a share, so working
            faster simply gets the cycle finished sooner.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {showQueueTools ? (
            <>
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
            </>
          ) : null}
          <Button
            size={showQueueTools ? "default" : "lg"}
            disabled={claimNext.isPending}
            onClick={() => {
              setExhausted(false);
              claimNext.mutate({ params: { path: { cycleId } } });
            }}
          >
            {claimNext.isPending
              ? "Finding one…"
              : items.length === 0
                ? "Start reviewing"
                : "Review next applicant"}
          </Button>
        </div>
      </div>

      {teamProgress.isSuccess ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            {/*
              The reviewer's own tally comes first. Work is claimed rather than
              allotted, so the team figure below has no personal answer in it -
              and the personal answer is the one people act on.
            */}
            <Progress
              value={Math.min(teamProgress.data.yourSubmitted, teamProgress.data.reviewerTarget)}
              max={Math.max(teamProgress.data.reviewerTarget, 1)}
              label="Your reviews"
            />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {`You have reviewed ${String(teamProgress.data.yourSubmitted)} of ${String(teamProgress.data.reviewerTarget)}`}
              </span>
              {teamProgress.data.yourSubmitted >= teamProgress.data.reviewerTarget
                ? " — target met, and anything further still counts."
                : ` · ${String(teamProgress.data.reviewerTarget - teamProgress.data.yourSubmitted)} to go`}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {teamProgress.isSuccess ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <Progress
              value={teamProgress.data.completeCount}
              max={Math.max(teamProgress.data.candidacyCount, 1)}
              label="Applications fully reviewed"
            />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {`${String(teamProgress.data.completeCount)} of ${String(teamProgress.data.candidacyCount)}`}
              </span>
              {" applications have all the reviews they need"}
              {teamProgress.data.remainingCandidacies > 0
                ? ` · ${String(teamProgress.data.remainingCandidacies)} still to go`
                : " · nothing left to read"}
              {` · ${String(teamProgress.data.reviewsSubmitted)} of ${String(teamProgress.data.reviewsRequired)} reviews submitted`}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {exhausted ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Nothing left to claim. Every applicant in your committees either has the reviews it needs
          or is already in your queue.
        </p>
      ) : null}
      {claimNext.isError ? (
        <ErrorState title="Could not claim a review" error={claimNext.error} />
      ) : null}

      {!showQueueTools ? (
        <UnfinishedReviews cycleId={cycleId} items={items} />
      ) : queue.isError ? (
        <ErrorState title="Could not load your review queue" error={queue.error} />
      ) : queue.isLoading ? (
        <TableSkeleton columns={COLUMNS} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing in your queue"
          description={
            committeeFilter === "" && statusFilter === ""
              ? "Nothing here yet. Press “Review next applicant” to take one."
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
                <TableCell>
                  <PriorityCell
                    tier={item.priorityTier}
                    hasCommitteeResponse={item.hasCommitteeResponse}
                  />
                </TableCell>
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

/**
 * The one piece of the old queue a reviewer still needs.
 *
 * Somebody who opened an application, started scoring it and closed the tab has
 * no other route back: pressing the button again claims a *different*
 * applicant, and the abandoned draft sits holding a slot until its claim
 * lapses. This is deliberately not a queue - no filters, no ranking, no way to
 * shop for an easier application - just the work already in hand.
 */
function UnfinishedReviews({
  cycleId,
  items,
}: {
  cycleId: string;
  items: Array<{ assignmentId: string; submitted: boolean; hasDraft: boolean }>;
}) {
  const open = items.filter((item) => !item.submitted);
  if (open.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5">
        <h3 className="text-sm font-semibold">
          {open.length === 1
            ? "You have one review open"
            : `You have ${String(open.length)} reviews open`}
        </h3>
        <p className="text-sm text-muted-foreground">
          Finish these before taking another, or they will be handed to somebody else in a couple of
          days.
        </p>
        <ul className="flex flex-col gap-1 pt-1">
          {open.map((item, index) => (
            <li key={item.assignmentId}>
              <Link
                to="/recruitment/$cycleId/review/$assignmentId"
                params={{ cycleId, assignmentId: item.assignmentId }}
                className="text-sm text-primary-strong underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.hasDraft
                  ? `Finish the review you started (${String(index + 1)})`
                  : `Open the application you claimed (${String(index + 1)})`}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
