import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "react-toastify";

import { ApplicationCard } from "@/components/applicant/ApplicationCard.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { useSession } from "@/lib/authClient";
import { formatDeadline } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/dashboard")({
  component: DashboardPage,
});

function firstName(full: string | undefined): string {
  if (full === undefined || full.trim() === "") {
    return "there";
  }
  return full.trim().split(/\s+/)[0]!;
}

/**
 * Where an applicant lands and returns.
 *
 * Reads the public cycle alongside the applicant's own profile, because the
 * committee limit lives on the cycle and this page has to know it: telling
 * somebody they have reached the limit is far better than offering a button
 * whose only outcome is a refusal on the next page.
 */
function DashboardPage() {
  const { data: auth } = useSession();
  const profile = $api.useQuery("get", "/me/profile", {}, absenceIsNormal);
  const cycle = $api.useQuery("get", "/cycles/current", {}, absenceIsNormal);
  const applications = $api.useQuery("get", "/me/applications", {});

  const withdraw = $api.useMutation("post", "/me/applications/{applicationId}/withdraw", {
    onSuccess: () => {
      void applications.refetch();
      toast.success("Your application has been withdrawn.");
    },
    onError: () => {
      /*
       * The server's refusal is the authority, and it is phrased for the
       * applicant. Reporting a generic failure here would hide, for instance,
       * that a decision has already been released - which is the one case
       * where this button should not have been offered at all.
       */
      toast.error("Could not withdraw that application. Reload the page and try again.");
    },
  });

  if (profile.isPending || applications.isPending || cycle.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  // No profile means no open cycle. An ordinary state between seasons, so it
  // gets an explanation rather than an error.
  if (profile.data === undefined) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-16">
        <div className="max-w-[62ch]">
          <h1 className="text-xl font-semibold">Applications are not open</h1>
          <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
            There is no recruitment cycle running at the moment. ScottyLabs recruits once a
            semester, so check back at the start of term.
          </p>
          <Link to="/recruit" className="mt-6 inline-block text-sm font-medium underline">
            See what ScottyLabs does
          </Link>
        </div>
      </div>
    );
  }

  const list = applications.data ?? [];
  const submitted = list.filter((row) => row.submittedAt !== null).length;
  const limit = cycle.data?.maxCommitteesPerApplicant ?? null;
  const atLimit = limit !== null && list.length >= limit;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <header className="max-w-[62ch]">
        <h1 className="text-xl font-semibold">Hello, {firstName(auth?.user.name)}</h1>
        <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
          {profile.data.cycleName}. Applications close{" "}
          {formatDeadline(profile.data.closesAt, cycle.data?.timeZone ?? "America/New_York")}.
        </p>
      </header>

      <section aria-labelledby="progress" className="mt-8">
        <h2 id="progress" className="text-sm font-semibold">
          Your progress
        </h2>
        {list.length === 0 ? (
          <p className="mt-2 max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
            You have not started an application yet. Pick the committees you are interested in, then
            answer the shared questions once and each committee&rsquo;s own questions.
          </p>
        ) : (
          <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
            {submitted} of {list.length} application{list.length === 1 ? "" : "s"} submitted.
            {submitted === list.length
              ? " Nothing is left to send."
              : " Unsubmitted drafts are not seen by any committee."}
          </p>
        )}
      </section>

      {list.length === 0 ? (
        <Link
          to="/app/committees"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Browse committees
        </Link>
      ) : (
        <>
          <section aria-labelledby="applications" className="mt-8">
            <h2 id="applications" className="sr-only">
              Your applications
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((row) => (
                <ApplicationCard
                  key={row.applicationId}
                  applicationId={row.applicationId}
                  committeeName={row.committeeName}
                  committeeSlug={row.committeeSlug}
                  status={row.status}
                  lastSavedAt={row.lastSavedAt}
                  submittedAt={row.submittedAt}
                  isWithdrawing={
                    withdraw.isPending &&
                    withdraw.variables?.params.path.applicationId === row.applicationId
                  }
                  onWithdraw={(applicationId) =>
                    withdraw.mutate({ params: { path: { applicationId } } })
                  }
                />
              ))}
            </div>
          </section>

          <div className="mt-8">
            {atLimit ? (
              <p className="text-sm text-muted-foreground">
                You have reached the limit of {limit} committee
                {limit === 1 ? "" : "s"} for this cycle.
              </p>
            ) : (
              <Link
                to="/app/committees"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium"
              >
                Apply to another committee
              </Link>
            )}
          </div>
        </>
      )}

      {submitted < list.length ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Ready to send?{" "}
          <Link to="/app/review" className="font-medium underline">
            Review and submit
          </Link>{" "}
          everything on one page.
        </p>
      ) : null}
    </div>
  );
}
