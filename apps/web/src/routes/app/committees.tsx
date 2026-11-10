import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import type { RankableApplication } from "@/components/applicant/PreferenceRanking.tsx";
import { PreferenceRanking } from "@/components/applicant/PreferenceRanking.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { formatDeadlineDate } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/committees")({
  component: CommitteesPage,
});

/**
 * Where an applicant chooses what to apply to.
 *
 * The page's job is that nobody walks into a refusal they could not see
 * coming. Apply is withheld for a committee already applied to, for a
 * committee that has not opened, and once the cycle's limit is reached — all
 * three of which the server enforces independently. Finding out from a server
 * error is the worst way to learn any of them.
 */
function CommitteesPage() {
  const cycle = $api.useQuery("get", "/cycles/current", {}, absenceIsNormal);
  const openings = $api.useQuery("get", "/openings", {});
  const applications = $api.useQuery("get", "/me/applications", {});

  const apply = $api.useMutation("post", "/me/applications", {
    onSuccess: () => {
      void applications.refetch();
    },
    onError: (error: unknown) => {
      /*
       * The server's own message, not a generic one.
       *
       * It knows things this page does not — another tab may have used the
       * last slot a second ago — and its wording is written for the applicant.
       */
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "Could not start that application. Reload the page and try again.";
      toast.error(message);
    },
  });

  const [order, setOrder] = useState<RankableApplication[] | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const savePreferences = $api.useMutation("patch", "/me/applications/preferences", {
    onSuccess: () => {
      setIsDirty(false);
      toast.success("Your order of preference has been saved.");
    },
  });

  const started = applications.data ?? [];

  /*
   * The ranking is seeded from the server's order and then owned locally.
   *
   * Re-deriving it on every refetch would throw away an order the applicant
   * had rearranged but not yet saved, which is the one thing this control must
   * not do. So it is seeded once per set of applications and left alone after.
   */
  useEffect(() => {
    setOrder((current) => {
      const next = started.map((row) => ({
        applicationId: row.applicationId,
        committeeName: row.committeeName,
      }));
      if (current === null) {
        return next;
      }
      const sameSet =
        current.length === next.length &&
        current.every((row) =>
          next.some((candidate) => candidate.applicationId === row.applicationId),
        );
      return sameSet ? current : next;
    });
  }, [started]);

  if (cycle.isPending || openings.isPending || applications.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const list = openings.data ?? [];
  const limit = cycle.data?.maxCommitteesPerApplicant ?? null;
  const atLimit = limit !== null && started.length >= limit;
  const timeZone = cycle.data?.timeZone ?? "America/New_York";
  const appliedByOpening = new Map(started.map((row) => [row.openingId, row]));

  function move(applicationId: string, direction: -1 | 1) {
    setOrder((current) => {
      if (current === null) {
        return current;
      }
      const index = current.findIndex((row) => row.applicationId === applicationId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setIsDirty(true);
  }

  // Nothing to order when there is one application: a form with one possible
  // answer is a question not worth asking.
  const needsRanking = cycle.data?.requirePreferenceRanking === true && started.length > 1;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <header className="max-w-[62ch]">
        <h1 className="text-xl font-semibold">Committees</h1>
        <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
          Apply to the committees you are genuinely interested in. The shared questions are answered
          once and reused, so a second application is only that committee&rsquo;s own questions.
        </p>
        {limit === null ? null : (
          <p className="mt-3 text-sm leading-6">
            {atLimit ? (
              <span>
                You have reached the limit of {limit} committee{limit === 1 ? "" : "s"} for this
                cycle. Withdraw one from your{" "}
                <Link to="/app/dashboard" className="font-medium underline">
                  dashboard
                </Link>{" "}
                if you want to apply somewhere else.
              </span>
            ) : (
              <span className="text-muted-foreground">
                You may apply to up to {limit} committees this cycle. You have started{" "}
                {started.length}.
              </span>
            )}
          </p>
        )}
      </header>

      {list.length === 0 ? (
        <p className="mt-8 max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          No committees are recruiting at the moment. When one opens, it will appear here with its
          deadline.
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((opening) => {
            const existing = appliedByOpening.get(opening.openingId);
            const headingId = `opening-${opening.teamSlug}`;
            const opensOn = formatDeadlineDate(opening.opensAt, timeZone);

            return (
              <article
                key={opening.openingId}
                aria-labelledby={headingId}
                className="flex flex-col rounded-[10px] border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 id={headingId} className="text-base font-semibold">
                    {opening.teamName}
                  </h2>
                  {existing === undefined ? null : <Badge variant="success">Already applied</Badge>}
                </div>

                {opening.description === null ? null : (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {opening.description}
                  </p>
                )}

                <div className="mt-4 flex-1" />

                {existing !== undefined ? (
                  <Link
                    to="/app/apply/$teamSlug"
                    params={{ teamSlug: opening.teamSlug }}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium"
                  >
                    Continue your application
                  </Link>
                ) : !opening.accepting ? (
                  <p className="text-sm text-muted-foreground">
                    {opensOn === ""
                      ? "Opening date to be announced."
                      : `Applications open ${opensOn}. Check back then.`}
                  </p>
                ) : atLimit ? (
                  <p className="text-sm text-muted-foreground">
                    Not available — you have reached this cycle&rsquo;s limit.
                  </p>
                ) : (
                  <Button
                    disabled={apply.isPending}
                    onClick={() => apply.mutate({ body: { openingId: opening.openingId } })}
                  >
                    {`Apply to ${opening.teamName}`}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {needsRanking && order !== null ? (
        <PreferenceRanking
          order={order}
          onMove={move}
          onSave={() =>
            savePreferences.mutate({
              body: { applicationIds: order.map((row) => row.applicationId) },
            })
          }
          isSaving={savePreferences.isPending}
          isDirty={isDirty}
        />
      ) : null}

      {started.length === 0 ? null : (
        <p className="mt-10 text-sm text-muted-foreground">
          Next, answer the{" "}
          <Link to="/app/apply/common" className="font-medium underline">
            shared questions
          </Link>{" "}
          once, then each committee&rsquo;s own.
        </p>
      )}
    </div>
  );
}
