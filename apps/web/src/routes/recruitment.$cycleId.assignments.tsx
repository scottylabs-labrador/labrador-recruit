import { canAssignReviewers } from "@labrador/access-control";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Loader2, Users } from "lucide-react";
import { useState } from "react";

import { CommitteePicker } from "@/components/recruitment/CommitteePicker.tsx";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input, Label } from "@/components/ui/field.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import { applicantLabel, type DistributionPlan } from "@/lib/recruitment.ts";

const WORKLOAD_COLUMNS = ["Reviewer", "Outstanding", "Submitted", "Conflicted", "Total assigned"];

export const Route = createFileRoute("/recruitment/$cycleId/assignments")({
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const { cycleId } = Route.useParams();
  const [selected, setSelected] = useState("");
  const [perCandidacy, setPerCandidacy] = useState(3);

  const standing = useRecruitmentUser(cycleId);
  const mayAssign = standing.isLoaded && canAssignReviewers({ user: standing.user });

  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });
  const committeeList = committees.data ?? [];
  const committeeId = selected === "" ? (committeeList[0]?.id ?? "") : selected;
  const hasCommittee = committeeId !== "";

  const workloads = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/workloads",
    { params: { path: { cycleId } } },
    { enabled: mayAssign },
  );

  // Preview and apply are the same call with a different flag, so what a person
  // confirms is exactly what was computed rather than a second guess at it.
  const distribute = $api.useMutation(
    "post",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/assignments/distribute",
  );

  const plan = distribute.data;
  const applied = plan?.created !== undefined;

  function preview() {
    distribute.mutate({
      params: { path: { cycleId, committeeId } },
      body: { reviewersPerCandidacy: perCandidacy, dryRun: true },
    });
  }

  function apply() {
    distribute.mutate(
      {
        params: { path: { cycleId, committeeId } },
        body: { reviewersPerCandidacy: perCandidacy, dryRun: false },
      },
      {
        onSuccess: () => {
          void workloads.refetch();
        },
      },
    );
  }

  if (standing.isLoaded && !mayAssign) {
    return (
      <EmptyState title="Assigning reviewers is a lead or admin action">
        <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          Assignments decide who reads which application, so they are made by a committee lead or a
          recruitment admin. Your own queue is under My Queue.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Assign reviewers</h2>
          <p className="max-w-[75ch] text-sm leading-6 text-muted-foreground">
            Tops every applicant in a committee up to the number of reviewers you set, spreading the
            work across whoever is enrolled. It only adds: nobody is unassigned, no started review
            is touched, and a declared conflict is never undone.
          </p>
        </div>
        <CommitteePicker
          id="assignment-committee"
          committees={committeeList}
          value={committeeId}
          onChange={(next) => {
            setSelected(next);
            distribute.reset();
          }}
        />
      </div>

      {committees.isError ? (
        <ErrorState title="Could not load committees" error={committees.error} />
      ) : !hasCommittee && !committees.isLoading ? (
        <EmptyState
          title="No committees configured"
          description="Add committees under Settings before assigning reviewers."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="per-candidacy">Reviewers per applicant</Label>
              <Input
                id="per-candidacy"
                type="number"
                min={1}
                max={10}
                className="w-28"
                value={perCandidacy}
                onChange={(event) => {
                  setPerCandidacy(Number(event.target.value));
                  distribute.reset();
                }}
              />
            </div>
            <Button onClick={preview} disabled={distribute.isPending}>
              {distribute.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Users aria-hidden />
              )}
              Preview assignments
            </Button>
            {plan && !applied && plan.planned.length > 0 ? (
              <Button variant="outline" onClick={apply} disabled={distribute.isPending}>
                <Check aria-hidden /> Assign {plan.planned.length}{" "}
                {plan.planned.length === 1 ? "reviewer" : "reviewers"}
              </Button>
            ) : null}
          </div>

          {distribute.isError ? (
            <ErrorState title="Could not work out the assignments" error={distribute.error} />
          ) : null}

          {plan ? <PlanSummary plan={plan} applied={applied} /> : null}
        </>
      )}

      <div>
        <h3 className="text-base font-semibold">Reviewer workload</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          Outstanding is what is actually waiting on someone: assigned or started, not yet
          submitted. It is what the split above balances on.
        </p>
        {workloads.isError ? (
          <ErrorState title="Could not load workloads" error={workloads.error} className="mt-3" />
        ) : workloads.isLoading ? (
          <TableSkeleton columns={WORKLOAD_COLUMNS} rows={4} />
        ) : (workloads.data ?? []).length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Nobody has an assignment yet"
            description="Preview a split above to give this cycle's reviewers their queues."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {WORKLOAD_COLUMNS.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(workloads.data ?? []).map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="font-medium">
                    {row.name ?? row.email ?? row.userId}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.outstanding}</TableCell>
                  <TableCell className="tabular-nums">{row.submitted}</TableCell>
                  <TableCell className="tabular-nums">{row.conflicted}</TableCell>
                  <TableCell className="tabular-nums">{row.assigned}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/**
 * The plan, named row by row.
 *
 * A count alone would not let anyone check the split before committing to it,
 * and this writes a queue for every reviewer in the committee at once.
 */
function PlanSummary({ plan, applied }: { plan: DistributionPlan; applied: boolean }) {
  const byReviewer = new Map<string, { name: string; total: number }>();
  for (const row of plan.planned) {
    const entry = byReviewer.get(row.reviewerUserId) ?? {
      name: row.reviewerName ?? row.reviewerUserId,
      total: 0,
    };
    entry.total += 1;
    byReviewer.set(row.reviewerUserId, entry);
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm leading-6">
        {applied ? (
          <>
            <Badge variant="success">Done</Badge>{" "}
            <span className="tabular-nums">{plan.created}</span> assignments created across{" "}
            <span className="tabular-nums">{plan.candidacyCount}</span> applicants.
          </>
        ) : plan.planned.length === 0 ? (
          <>
            Every one of <span className="tabular-nums">{plan.candidacyCount}</span> applicants
            already has enough reviewers. Nothing to do.
          </>
        ) : (
          <>
            <span className="tabular-nums">{plan.planned.length}</span> assignments across{" "}
            <span className="tabular-nums">{plan.candidacyCount}</span> applicants, shared between{" "}
            <span className="tabular-nums">{byReviewer.size}</span> of{" "}
            <span className="tabular-nums">{plan.reviewerCount}</span> eligible reviewers. Nothing
            is written until you confirm.
          </>
        )}
      </p>

      {byReviewer.size > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {[...byReviewer.entries()]
            .sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name))
            .map(([userId, entry]) => (
              <li key={userId}>
                <Badge variant="outline">
                  {entry.name} <span className="tabular-nums">+{entry.total}</span>
                </Badge>
              </li>
            ))}
        </ul>
      ) : null}

      {plan.shortfalls.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-600/30 bg-amber-600/10 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" aria-hidden />
            {plan.shortfalls.length}{" "}
            {plan.shortfalls.length === 1 ? "applicant cannot" : "applicants cannot"} reach that
            many reviewers
          </p>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
            Every eligible reviewer is already on them. Enrol more people for this committee under
            Settings, or lower the number. The rest of the split still applies.
          </p>
          <ul className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto text-sm leading-6">
            {plan.shortfalls.slice(0, 25).map((row) => (
              <li key={row.candidacyId}>
                {applicantLabel(row.applicantName)} — {row.have} of {row.want}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!applied && plan.planned.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Show all {plan.planned.length} assignments
          </summary>
          <ul
            aria-label="Planned assignments"
            className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto text-sm leading-6"
          >
            {plan.planned.map((row) => (
              <li key={`${row.candidacyId}:${row.reviewerUserId}`}>
                {applicantLabel(row.applicantName)}{" "}
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>{" "}
                <span className="sr-only">assigned to</span>
                <span className="font-medium">{row.reviewerName ?? row.reviewerUserId}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
