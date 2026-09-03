import { $api } from "@/lib/apiClient";

interface ScopedCommittee {
  id: string;
  slug: string;
  name: string;
  capacity: number | null;
  displayOrder: number;
}

interface ScopedCommittees {
  /** The committees in scope, already filtered. */
  committees: ScopedCommittee[];
  /**
   * True when the cycle is pinned to a single committee, so a picker would be
   * a control with one option — worse than no control at all.
   */
  scoped: boolean;
  /** The committee to show when nothing has been chosen. */
  defaultCommitteeId: string;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * The committees a cycle's screens should offer.
 *
 * A cycle can be pinned to one committee (`reviewCommitteeId`), which is how a
 * deployment stood up for a single team avoids showing six committees its
 * reviewers will never touch. This filters rather than deletes: the other
 * candidacies and every applicant's full set of preferences stay in the
 * database, so widening back out is a settings change.
 *
 * Scoping is presentation only. What somebody may actually read is decided by
 * `recruitment_membership` and enforced in SQL, so narrowing this can never
 * widen access, and a caller who edits the URL gains nothing.
 */
export function useScopedCommittees(cycleId: string): ScopedCommittees {
  const cycle = $api.useQuery("get", "/recruitment/cycles/{cycleId}", {
    params: { path: { cycleId } },
  });
  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });

  const all = committees.data ?? [];
  const pinned = cycle.data?.reviewCommitteeId ?? null;

  // A pin naming a committee this cycle does not run would otherwise empty
  // every screen. Fall back to the full list and let the interface behave as
  // though it were unpinned.
  const match = pinned === null ? undefined : all.find((row) => row.id === pinned);
  const inScope = match === undefined ? all : [match];

  return {
    committees: inScope,
    scoped: match !== undefined,
    defaultCommitteeId: inScope[0]?.id ?? "",
    isLoading: cycle.isLoading || committees.isLoading,
    isPending: cycle.isPending || committees.isPending,
    isError: committees.isError,
    error: committees.error,
  };
}
