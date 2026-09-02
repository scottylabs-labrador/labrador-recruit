import { createFileRoute, Link } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { useState } from "react";

import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import {
  applicantLabel,
  countFor,
  formatRank,
  formatStatistic,
  RECOMMENDATION_OPTIONS,
  type CandidacyAggregate,
} from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/disagreements")({
  component: DisagreementsPage,
});

function DisagreementsPage() {
  const { cycleId } = Route.useParams();
  const [selected, setSelected] = useState("");

  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });

  const committeeList = committees.data ?? [];
  const committeeId = selected === "" ? (committeeList[0]?.id ?? "") : selected;
  const hasCommittee = committeeId !== "";

  const disagreements = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/disagreements",
    { params: { path: { cycleId, committeeId } } },
    { enabled: hasCommittee },
  );

  const items = disagreements.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Disagreement queue</h2>
          <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
            Candidacies where the submitted reviews diverge past this cycle&rsquo;s configured
            thresholds. A flag is never a verdict — it asks for another human reviewer.
          </p>
        </div>
        <CommitteePicker
          id="disagreements-committee"
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
          description="A recruitment admin configures committees before disagreement can be measured."
        />
      ) : disagreements.isError ? (
        <ErrorState title="Could not load the disagreement queue" error={disagreements.error} />
      ) : committees.isLoading || disagreements.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No disagreements flagged"
          description="Every candidacy in this committee is within the configured thresholds."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.candidacyId}>
              <DisagreementCard cycleId={cycleId} aggregate={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DisagreementCard({
  cycleId,
  aggregate,
}: {
  cycleId: string;
  aggregate: CandidacyAggregate;
}) {
  const distribution = RECOMMENDATION_OPTIONS.map((option) => ({
    label: option.label,
    count: countFor(aggregate.recommendationCounts, option.value),
  })).filter((entry) => entry.count > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>
            <Link
              to="/recruitment/$cycleId/applicant/$applicationId"
              params={{ cycleId, applicationId: aggregate.applicationId }}
              className="rounded-md text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {applicantLabel(aggregate.applicantName)}
            </Link>
          </CardTitle>
          <Badge variant="warning">
            <Flag aria-hidden /> Flagged
          </Badge>
          <Badge variant="muted">Their rank {formatRank(aggregate.applicantRank)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Why this is flagged</h3>
          {aggregate.disagreement.reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reason was recorded for this flag.</p>
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[0.95rem] leading-7">
              {aggregate.disagreement.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Reviews</dt>
            <dd className="tabular-nums">
              {aggregate.submittedCount}/{aggregate.minimumReviews}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mean</dt>
            <dd className="tabular-nums">{formatStatistic(aggregate.statistics.mean)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Median</dt>
            <dd className="tabular-nums">{formatStatistic(aggregate.statistics.median)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Spread</dt>
            <dd className="tabular-nums">{formatStatistic(aggregate.statistics.spread)}</dd>
          </div>
        </dl>

        {distribution.length === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            Recommendations:{" "}
            {distribution.map((entry) => `${entry.label} ${entry.count}`).join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
