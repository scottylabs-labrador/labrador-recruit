import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Flag } from "lucide-react";

import { ApplicationView } from "@/components/recruitment/ApplicationView.tsx";
import { GithubFacts } from "@/components/recruitment/GithubFacts.tsx";
import { PeerReviews } from "@/components/recruitment/PeerReviews.tsx";
import { ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import { formatStatistic } from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/applicant/$applicationId")({
  component: ApplicantDetailPage,
});

function ApplicantDetailPage() {
  const { cycleId, applicationId } = Route.useParams();
  const { isLeadership } = useRecruitmentUser(cycleId);

  const application = $api.useQuery("get", "/recruitment/applications/{applicationId}", {
    params: { path: { applicationId } },
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/recruitment/$cycleId/applicants"
        params={{ cycleId }}
        className="inline-flex w-fit items-center gap-1 rounded-md text-sm font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to applicants
      </Link>

      {application.isError ? (
        <ErrorState title="Could not load this application" error={application.error} />
      ) : application.isLoading || application.data === undefined ? (
        <div className="flex max-w-4xl flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <div className="max-w-4xl">
          {/*
            `friendRequest` is leadership-only context that must never reach a
            scoring path, so it is shown here — away from the rubric — and only to
            a committee lead or recruitment admin. There is no `readLeadershipContext`
            action in `@labrador/access-control` to ask for this, so the roles the
            server sent on `/me` are read directly rather than repurposing an
            unrelated predicate.
          */}
          <ApplicationView application={application.data} showLeadershipContext={isLeadership} />
          {/*
            Beside the application rather than inside it, because it is not
            something the applicant submitted to us: it is what GitHub says,
            fetched separately and labelled as such.
          */}
          <div className="mt-6">
            <GithubFacts applicationId={applicationId} />
          </div>

          {/*
            What the committee made of them, under what they submitted.
            Keyed by candidacy rather than application because one applicant
            can be under consideration by several committees at once, each
            with its own reviews and its own verdict.
          */}
          {application.data.preferences
            .filter((preference) => preference.candidacyId !== null)
            .map((preference) => (
              <div key={preference.committeeId} className="mt-6">
                <CandidacyVerdict
                  candidacyId={preference.candidacyId ?? ""}
                  committeeName={preference.name}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * One committee's verdict on this applicant: whether the reviews diverged
 * enough to be flagged, the statistics that decided it, and every review
 * behind them.
 *
 * The flag and its reasons come from the same aggregation the disagreement
 * queue reads, so an application and that queue can never describe the same
 * candidacy differently.
 */
function CandidacyVerdict({
  candidacyId,
  committeeName,
}: {
  candidacyId: string;
  committeeName: string;
}) {
  const aggregate = $api.useQuery("get", "/recruitment/candidacies/{candidacyId}/aggregate", {
    params: { path: { candidacyId } },
  });

  return (
    <div className="flex flex-col gap-4">
      {aggregate.isError ? (
        // Not an error state for the page: a reviewer who has not submitted
        // their own review yet is not allowed these numbers, and saying so is
        // more useful than an error about permissions.
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            The {committeeName} scores are not available to you yet.
          </CardContent>
        </Card>
      ) : aggregate.isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : aggregate.data === undefined ? null : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{committeeName} review</CardTitle>
              {aggregate.data.disagreement.flagged ? (
                <Badge variant="warning">
                  <Flag aria-hidden /> Disagreement
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {aggregate.data.disagreement.flagged ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Why this is flagged</h3>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[0.95rem] leading-7">
                  {aggregate.data.disagreement.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Reviews</dt>
                <dd className="tabular-nums">
                  {aggregate.data.submittedCount}/{aggregate.data.minimumReviews}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mean</dt>
                <dd className="tabular-nums">{formatStatistic(aggregate.data.statistics.mean)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Median</dt>
                <dd className="tabular-nums">
                  {formatStatistic(aggregate.data.statistics.median)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Spread</dt>
                <dd className="tabular-nums">
                  {formatStatistic(aggregate.data.statistics.spread)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      <PeerReviews
        candidacyId={candidacyId}
        title={`What each ${committeeName} reviewer said`}
        description="Every submitted review of this applicant for this committee."
      />
    </div>
  );
}
