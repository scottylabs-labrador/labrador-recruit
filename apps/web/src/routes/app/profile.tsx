import { createFileRoute, Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { useSession } from "@/lib/authClient";
import { formatDeadline } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

/**
 * Who the platform thinks you are, and what it does with what you wrote.
 *
 * **Nothing here is editable, and the page says why.** Name and Andrew ID come
 * from CMU at sign-in and are refreshed from there every time, so a field to
 * change them would either silently fail or be overwritten on the next visit —
 * both worse than an explanation.
 *
 * TODO(#23): there is no applicant-editable profile field yet. `docs/ui.md`
 * section 1 anticipates one (a pronoun, a preferred name), which needs a
 * column and an endpoint rather than a form here.
 */
function ProfilePage() {
  const { data: auth } = useSession();
  const profile = $api.useQuery("get", "/me/profile", {}, absenceIsNormal);
  const cycle = $api.useQuery("get", "/cycles/current", {}, absenceIsNormal);

  if (profile.isPending) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const timeZone = cycle.data?.timeZone ?? "America/New_York";

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10">
      <h1 className="text-xl font-semibold">Your profile</h1>

      <section aria-labelledby="identity" className="mt-8">
        <h2 id="identity" className="text-base font-semibold">
          Your details
        </h2>
        <dl className="mt-3 space-y-3">
          <div>
            <dt className="text-xs tracking-wide text-muted-foreground uppercase">Name</dt>
            <dd className="mt-0.5 text-sm">{auth?.user.name ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-muted-foreground uppercase">Email</dt>
            <dd className="mt-0.5 text-sm">{auth?.user.email ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-muted-foreground uppercase">Andrew ID</dt>
            <dd className="mt-0.5 text-sm">{auth?.user.id ?? "Not provided"}</dd>
          </div>
        </dl>
        <p className="mt-4 max-w-[62ch] text-sm leading-6 text-muted-foreground">
          This comes from CMU when you sign in and is refreshed every time, so it cannot be changed
          here. If something is wrong, it needs correcting at CMU — or tell ScottyLabs and they will
          work around it.
        </p>
      </section>

      <section aria-labelledby="cycle" className="mt-10 border-t border-border pt-8">
        <h2 id="cycle" className="text-base font-semibold">
          This recruitment cycle
        </h2>
        {profile.data === undefined ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            There is no recruitment cycle running at the moment.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6">{profile.data.cycleName}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Applications close {formatDeadline(profile.data.closesAt, timeZone)}.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {profile.data.commonLocked ? (
                <>
                  You have submitted an application, so your shared answers can no longer be
                  changed. You can still{" "}
                  <Link to="/app/apply/common" className="font-medium underline">
                    read them
                  </Link>
                  .
                </>
              ) : (
                <>
                  Your{" "}
                  <Link to="/app/apply/common" className="font-medium underline">
                    shared answers
                  </Link>{" "}
                  can still be changed until you submit.
                </>
              )}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="data-use" className="mt-10 border-t border-border pt-8">
        <h2 id="data-use" className="text-base font-semibold">
          What happens to what you wrote
        </h2>
        <ul className="mt-3 max-w-[62ch] space-y-2 text-sm leading-6 text-muted-foreground">
          <li>
            Applicants are not evaluated by any model. No score is inferred from anything you wrote;
            every subjective score comes from a named human reviewer.
          </li>
          <li>
            Your answers are visible to reviewers on the committees you applied to, and to
            ScottyLabs administrators. A committee cannot see an application you did not send it.
          </li>
          <li>Drafts are not visible to any committee until you submit.</li>
        </ul>
      </section>
    </div>
  );
}
