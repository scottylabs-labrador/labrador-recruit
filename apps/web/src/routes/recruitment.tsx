import { canConfigureCycle, canImportApplications } from "@labrador/access-control";
import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";

import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Label, Select } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { type RecruitmentStanding, useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recruitment")({
  component: RecruitmentLayout,
});

/**
 * `visible` is evaluated against the caller's own standing, using the very
 * predicates the server checks. An administrative screen is therefore absent
 * from the navigation for a reviewer rather than present and refused — the
 * server still refuses it, but a reviewer is never shown a door they cannot
 * open.
 */
type NavPath =
  | "/recruitment/$cycleId"
  | "/recruitment/$cycleId/queue"
  | "/recruitment/$cycleId/applicants"
  | "/recruitment/$cycleId/ranking"
  | "/recruitment/$cycleId/disagreements"
  | "/recruitment/$cycleId/import"
  | "/recruitment/$cycleId/rubric"
  | "/recruitment/$cycleId/exports";

interface NavItem {
  to: NavPath;
  label: string;
  exact: boolean;
  visible: (standing: RecruitmentStanding) => boolean;
}

function always(): boolean {
  return true;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/recruitment/$cycleId", label: "Overview", exact: true, visible: always },
  { to: "/recruitment/$cycleId/queue", label: "My Queue", exact: false, visible: always },
  { to: "/recruitment/$cycleId/applicants", label: "Applicants", exact: false, visible: always },
  { to: "/recruitment/$cycleId/ranking", label: "Ranking", exact: false, visible: always },
  {
    to: "/recruitment/$cycleId/disagreements",
    label: "Disagreements",
    exact: false,
    visible: always,
  },
  {
    to: "/recruitment/$cycleId/import",
    label: "Import",
    exact: false,
    visible: (standing) => canImportApplications({ user: standing.user }),
  },
  {
    to: "/recruitment/$cycleId/rubric",
    label: "Rubric",
    exact: false,
    visible: (standing) => canConfigureCycle({ user: standing.user }),
  },
  {
    // Committee leads hold aggregate visibility for their own committee, so the
    // ranking export is theirs to take; the cycle-wide files inside the screen
    // stay gated on `canDecidePlacement`.
    to: "/recruitment/$cycleId/exports",
    label: "Exports",
    exact: false,
    visible: (standing) => standing.isLeadership,
  },
];

function RecruitmentLayout() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const cycleId = params.cycleId;
  const standing = useRecruitmentUser(cycleId ?? null);

  const { data: cycles, isLoading, isError, error } = $api.useQuery("get", "/recruitment/cycles");

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-4 h-8 w-full max-w-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <ErrorState title="Could not load your recruitment cycles" error={error} />
      </div>
    );
  }

  const list = cycles ?? [];

  if (list.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <h1 className="mb-4 text-xl font-semibold">Recruitment</h1>
        <EmptyState title="You are not part of a recruitment cycle yet">
          <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
            Recruitment data is scoped to a cycle, and you can only see a cycle you hold a
            recruitment membership in. Being signed in — even as a ScottyLabs admin — is not enough
            on its own. Ask a recruitment admin to add you to the cycle as a reviewer, committee
            lead, or recruitment admin, then reload this page.
          </p>
        </EmptyState>
      </div>
    );
  }

  const activeCycle = list.find((cycle) => cycle.id === cycleId);

  // `/recruitment/cycles` returns only cycles the caller holds standing in, so a
  // cycle id that is absent from it is a cycle they have no access to. Saying so
  // once here is clearer than letting every child screen fail its own request.
  if (cycleId !== undefined && activeCycle === undefined) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <h1 className="mb-4 text-xl font-semibold">Recruitment</h1>
        <EmptyState title="You do not have access to this cycle">
          <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
            You hold no recruitment membership in this cycle, so none of its applicants, reviews, or
            rankings are visible to you.
          </p>
          <Link
            to="/recruitment"
            className="text-primary-strong underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            See the cycles you can open
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 py-5">
      <header className="flex flex-col gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl leading-tight font-semibold">Recruitment</h1>
            <p className="text-sm text-muted-foreground">
              {activeCycle === undefined
                ? "Choose a cycle to begin."
                : `${activeCycle.name} · ${activeCycle.status}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cycle-picker">Recruitment cycle</Label>
            <Select
              id="cycle-picker"
              className="w-56"
              value={cycleId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value;
                if (nextId === "") return;
                void navigate({ to: "/recruitment/$cycleId", params: { cycleId: nextId } });
              }}
            >
              <option value="">Select a cycle…</option>
              {list.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {cycleId === undefined ? null : (
          <nav aria-label="Recruitment sections" className="flex flex-wrap gap-1">
            {NAV_ITEMS.filter((item) => item.visible(standing)).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ cycleId }}
                activeOptions={{ exact: item.exact }}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
                activeProps={{ className: "bg-muted text-foreground", "aria-current": "page" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="min-h-0 flex-1 pt-5">
        {cycleId === undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((cycle) => (
              <Card key={cycle.id}>
                <CardHeader>
                  <CardTitle>
                    <Link
                      to="/recruitment/$cycleId"
                      params={{ cycleId: cycle.id }}
                      className="text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {cycle.name}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="font-medium text-foreground">Status</dt>
                    <dd>{cycle.status}</dd>
                    <dt className="font-medium text-foreground">Minimum reviews</dt>
                    <dd>{cycle.minimumReviews}</dd>
                    <dt className="font-medium text-foreground">Blind review</dt>
                    <dd>{cycle.blindReviewEnabled ? "On" : "Off"}</dd>
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}
