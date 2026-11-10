import { createFileRoute, Link } from "@tanstack/react-router";

import { CommitteeCard } from "@/components/recruit/CommitteeCard.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { formatDeadline } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/recruit")({
  component: RecruitPage,
});

/**
 * The public recruitment landing page.
 *
 * Renders from `/v1/cycles/current` and `/v1/openings` and nothing else. Both
 * are unauthenticated, and both deliberately carry only what a poster on a
 * wall could say — no applicant data and no counts. A signed-in applicant is
 * not redirected away: this is also the page somebody shares, and arriving at
 * a dashboard instead of the committee you were sent a link about is worse
 * than a second click.
 */
function RecruitPage() {
  const cycle = $api.useQuery("get", "/cycles/current", {}, absenceIsNormal);
  const openings = $api.useQuery("get", "/openings", {});

  if (cycle.isPending || openings.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="mt-4 h-20 w-full max-w-[62ch]" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    );
  }

  /*
   * A 404 from the cycle endpoint is an ordinary state, not an error.
   *
   * Between seasons there is no cycle, and the endpoint says so without
   * naming a draft one that may exist. Rendering an error page for that would
   * make a perfectly healthy deployment look broken.
   */
  const current = cycle.data;
  const list = openings.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-12">
      <header className="max-w-[62ch]">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          ScottyLabs Recruit
        </p>
        <h1 className="mt-2 text-2xl leading-tight font-semibold">
          {current === undefined ? "Applications are not open right now" : current.name}
        </h1>

        {current === undefined ? (
          <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
            Applications are not open at the moment. ScottyLabs recruits once a semester, so check
            back at the start of term or follow ScottyLabs for the announcement.
          </p>
        ) : (
          <>
            <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
              {current.description ??
                "Apply to ScottyLabs committees in one place. Answer the shared questions once, answer each committee's own questions, and track every application from here."}
            </p>
            <p className="mt-4 text-[0.95rem] leading-7">
              <span className="font-medium">Applications close</span>{" "}
              {formatDeadline(current.closesAt, current.timeZone)}
            </p>
            {current.maxCommitteesPerApplicant === null ? null : (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                You may apply to up to {current.maxCommitteesPerApplicant} committees this cycle.
              </p>
            )}
          </>
        )}

        <p className="mt-4 text-[0.95rem] leading-7 text-muted-foreground">
          Applicants are not evaluated by any model. Every subjective score comes from a named human
          reviewer, and every figure the platform reports is arithmetic over those scores.
        </p>

        <Link
          to="/signin"
          search={{ redirect: "/app/dashboard" }}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Sign in to apply
        </Link>
      </header>

      <section aria-labelledby="committees" className="mt-14">
        <h2 id="committees" className="text-lg font-semibold">
          Committees
        </h2>
        {list.length === 0 ? (
          <p className="mt-3 max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
            No committees are recruiting at the moment. When a committee opens, it will appear here
            with its deadline.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((opening) => (
              <CommitteeCard
                key={opening.openingId}
                teamSlug={opening.teamSlug}
                teamName={opening.teamName}
                description={opening.description}
                accepting={opening.accepting}
                opensAt={opening.opensAt}
                closesAt={opening.closesAt}
                timeZone={current?.timeZone ?? "America/New_York"}
                applyTo="/signin"
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="how-to-apply" className="mt-14 max-w-[62ch]">
        <h2 id="how-to-apply" className="text-lg font-semibold">
          How to apply
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[0.95rem] leading-7 text-muted-foreground">
          <li>Sign in with your Andrew ID. Every CMU student has one; there is no signup.</li>
          <li>
            Answer the shared questions once. They are the same for every committee, so you write
            them a single time.
          </li>
          <li>Pick the committees you want to apply to and answer each one&rsquo;s questions.</li>
          <li>
            Review everything on one page and submit. Nothing is sent to a committee until you
            submit, and your drafts save as you type.
          </li>
        </ol>
      </section>

      <section aria-labelledby="faq" className="mt-14 max-w-[62ch]">
        <h2 id="faq" className="text-lg font-semibold">
          Questions
        </h2>
        <dl className="mt-3 space-y-5">
          <div>
            <dt className="text-sm font-medium">Can I apply to more than one committee?</dt>
            <dd className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">
              Yes.{" "}
              {current?.maxCommitteesPerApplicant == null
                ? "Apply to as many as you are genuinely interested in."
                : `This cycle allows up to ${current.maxCommitteesPerApplicant}.`}{" "}
              The shared questions are answered once and reused.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Can I edit my application after submitting?</dt>
            <dd className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">
              No. Submitting is final, which is why there is a review page first. You can withdraw
              an application you no longer want considered.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Who reads my application?</dt>
            <dd className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">
              Reviewers on the committees you applied to, and ScottyLabs administrators. A committee
              cannot see an application you did not send it, and no model reads it.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium">What if I miss the deadline?</dt>
            <dd className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">
              The deadline is enforced by the server, not by your browser, so a draft left
              unsubmitted stays a draft. Contact ScottyLabs if something went wrong.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
