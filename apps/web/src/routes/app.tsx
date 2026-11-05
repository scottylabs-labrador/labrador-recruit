import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignOutButton } from "@/components/user/SignOutButton";
import { $api } from "@/lib/apiClient";
import { authClient, useSession } from "@/lib/authClient";
import { formatDeadline } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

/**
 * The applicant surface, and the guard in front of it.
 *
 * **The guard is a navigation courtesy, not the security boundary.** Every
 * endpoint behind these pages refuses an unauthenticated request on its own,
 * and every one of them is scoped to the caller's own profile. What this
 * achieves is that somebody following a link while signed out gets a sign-in
 * page that returns them to where they were going, instead of a page full of
 * failed requests. See `docs/authorization.md`.
 */
export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();
    if (!data) {
      /*
       * `location.href` rather than `pathname`, so a link carrying search
       * params survives the round trip. The sign-in page validates it back to
       * a same-site path before using it.
       */
      throw redirect({ to: "/signin", search: { redirect: location.href } });
    }
  },
  component: ApplicantLayout,
});

function ApplicantLayout() {
  const { data: auth } = useSession();
  const profile = $api.useQuery("get", "/me/profile", {}, absenceIsNormal);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            {profile.isPending ? (
              <Skeleton className="h-5 w-56" />
            ) : profile.data === undefined ? (
              /*
               * No profile means no open cycle, which is an ordinary state
               * between seasons rather than an error. The pages below say so
               * in their own words; the header simply has nothing to add.
               */
              <p className="text-sm text-muted-foreground">ScottyLabs Recruit</p>
            ) : (
              <>
                <p className="truncate text-sm font-semibold">{profile.data.cycleName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Closes {formatDeadline(profile.data.closesAt, "America/New_York")}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            {auth?.user.name === undefined ? null : (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {auth.user.name}
              </span>
            )}
            <SignOutButton />
          </div>
        </div>

        <nav aria-label="Your application" className="mx-auto w-full max-w-[1400px] px-6">
          <ul className="-mb-px flex flex-wrap gap-1 text-sm">
            {[
              { to: "/app/dashboard", label: "Dashboard" },
              { to: "/app/committees", label: "Committees" },
              { to: "/app/apply/common", label: "Shared questions" },
              { to: "/app/review", label: "Review & submit" },
              { to: "/app/submissions", label: "History" },
              { to: "/app/profile", label: "Profile" },
            ].map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="inline-block border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "border-primary text-foreground font-medium" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
