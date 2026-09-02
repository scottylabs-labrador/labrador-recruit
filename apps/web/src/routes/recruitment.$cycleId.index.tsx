import { useQueries } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ClipboardList, Users } from "lucide-react";

import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { percent, type CandidacyAggregate } from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/")({
  component: CycleOverviewPage,
});

function CycleOverviewPage() {
  const { cycleId } = Route.useParams();

  // Counted server-side, so the overview no longer pulls every application row
  // across the wire just to take its length.
  const progress = $api.useQuery("get", "/recruitment/cycles/{cycleId}/progress", {
    params: { path: { cycleId } },
  });
  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });
  const queue = $api.useQuery("get", "/recruitment/cycles/{cycleId}/my-queue", {
    params: { path: { cycleId } },
  });

  const committeeList = committees.data ?? [];
  const aggregateQueries = useQueries({
    queries: committeeList.map((committee) =>
      $api.queryOptions(
        "get",
        "/recruitment/cycles/{cycleId}/committees/{committeeId}/aggregates",
        { params: { path: { cycleId, committeeId: committee.id } } },
      ),
    ),
  });

  if (progress.isError || committees.isError || queue.isError) {
    return (
      <ErrorState
        title="Could not load this cycle"
        error={progress.error ?? committees.error ?? queue.error}
      />
    );
  }

  if (progress.isLoading || committees.isLoading || queue.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <CardGridSkeleton />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const queueList = queue.data ?? [];

  const applicantCount = progress.data?.applicationCount ?? 0;
  const candidacyCount = progress.data?.candidacyCount ?? 0;

  const assignedCount = queueList.length;
  const completedCount = queueList.filter((item) => item.submitted).length;
  const conflictedCount = queueList.filter((item) => item.status === "conflicted").length;
  const outstandingCount = assignedCount - completedCount - conflictedCount;

  const aggregatesReady = aggregateQueries.every((query) => query.isSuccess);
  const aggregatesFailed = aggregateQueries.some((query) => query.isError);
  const allAggregates = aggregateQueries.flatMap((query) => query.data ?? []);
  const disagreementCount = allAggregates.filter(
    (aggregate) => aggregate.disagreement.flagged,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="cycle-totals-heading" className="flex flex-col gap-3">
        <h2 id="cycle-totals-heading" className="sr-only">
          Cycle totals
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Users className="size-4" aria-hidden />}
            label="Applicants"
            value={applicantCount}
            detail={`${candidacyCount} candidac${candidacyCount === 1 ? "y" : "ies"} across committees`}
          />
          <StatCard
            icon={<ClipboardList className="size-4" aria-hidden />}
            label="Reviews assigned to you"
            value={assignedCount}
            detail={conflictedCount > 0 ? `${conflictedCount} conflicted` : "No conflicts declared"}
          />
          <StatCard
            icon={<CheckCircle2 className="size-4" aria-hidden />}
            label="Completed by you"
            value={completedCount}
            detail={`${outstandingCount} outstanding`}
          />
          <StatCard
            icon={<AlertTriangle className="size-4" aria-hidden />}
            label="Flagged for disagreement"
            value={aggregatesReady ? disagreementCount : "—"}
            detail={
              aggregatesFailed
                ? "Some committees could not be loaded"
                : aggregatesReady
                  ? "Each flag states its reason"
                  : "Loading committee data…"
            }
          />
        </div>
      </section>

      <section aria-labelledby="committee-progress-heading" className="flex flex-col gap-3">
        <h2 id="committee-progress-heading" className="text-base font-semibold">
          Review progress by committee
        </h2>
        {committeeList.length === 0 ? (
          <EmptyState
            title="No committees configured"
            description="A recruitment admin configures committees for the cycle before reviews can be assigned."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {committeeList.map((committee, index) => {
              const query = aggregateQueries[index];
              return (
                <Card key={committee.id}>
                  <CardHeader>
                    <CardTitle>{committee.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {query === undefined || query.isPending ? (
                      <Skeleton className="h-10 w-full" />
                    ) : query.isError ? (
                      <ErrorState title="Could not load progress" error={query.error} />
                    ) : (
                      <CommitteeProgress aggregates={query.data ?? []} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Every figure here is a count or a sum over reviews submitted by named people. Open{" "}
        <Link
          to="/recruitment/$cycleId/ranking"
          params={{ cycleId }}
          className="text-primary-strong underline underline-offset-4"
        >
          Ranking
        </Link>{" "}
        to see the reviews behind each one.
      </p>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  detail: string;
}

function StatCard({ icon, label, value, detail }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 px-5 py-4">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </CardContent>
    </Card>
  );
}

/**
 * Progress is `submitted reviews / required reviews`, capped per candidacy so a
 * candidacy with extra reviewers cannot mask one with none. Plain arithmetic
 * over human-entered reviews, reproducible by hand.
 */
function CommitteeProgress({ aggregates }: { aggregates: CandidacyAggregate[] }) {
  if (aggregates.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidacies in this committee yet.</p>;
  }

  const required = aggregates.reduce((total, item) => total + item.minimumReviews, 0);
  const done = aggregates.reduce(
    (total, item) => total + Math.min(item.submittedCount, item.minimumReviews),
    0,
  );
  const complete = aggregates.filter((item) => item.submittedCount >= item.minimumReviews).length;
  const flagged = aggregates.filter((item) => item.disagreement.flagged).length;

  return (
    <div className="flex flex-col gap-2">
      <Progress value={done} max={required} label="Reviews submitted" />
      <p className="text-sm text-muted-foreground">
        {done} of {required} required reviews submitted ({percent(done, required)}%) · {complete} of{" "}
        {aggregates.length} candidacies fully reviewed
        {flagged > 0 ? ` · ${flagged} flagged` : ""}
      </p>
    </div>
  );
}
