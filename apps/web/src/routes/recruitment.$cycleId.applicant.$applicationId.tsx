import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { ApplicationView } from "@/components/recruitment/ApplicationView.tsx";
import { ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";

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
        </div>
      )}
    </div>
  );
}
