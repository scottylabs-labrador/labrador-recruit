import type { Membership, RecruitmentRole, RecruitmentUser, Role } from "@labrador/access-control";
import { canDecideCommittee } from "@labrador/access-control";

import { $api } from "@/lib/apiClient";
import { useSession } from "@/lib/authClient";

const GLOBAL_ROLES: readonly Role[] = ["admin", "user", "guest"];

export interface RecruitmentStanding {
  /** The caller as the `@labrador/access-control` predicates expect them. */
  user: RecruitmentUser;
  /** False while `/me` is still in flight, so callers can hold off on gating. */
  isLoaded: boolean;
  /**
   * True when the caller holds no standing in this cycle. `/me` 404s in that
   * case, which is an answer rather than a failure.
   */
  hasNoAccess: boolean;
  /**
   * True for a `committee_lead` or `recruitment_admin`. Read straight off the
   * memberships the server sent, not re-derived from anything else.
   */
  isLeadership: boolean;
  /**
   * Whether the caller may record a committee decision for this committee.
   *
   * Asks the same predicate the server asks, so the interface offers a control
   * exactly when the API would accept it. A committee lead may decide only for
   * the committees they lead - being a reviewer elsewhere is not enough - which
   * is why this takes the committee rather than being a single boolean.
   */
  canDecideForCommittee: (committeeId: string) => boolean;
}

/**
 * Loads the caller's own recruitment standing and assembles the
 * `RecruitmentUser` that `@labrador/access-control` takes, so the browser
 * evaluates the identical predicates the server evaluates rather than guessing.
 *
 * While `/me` is in flight the caller is treated as having no standing at all.
 * That direction is the safe one: it hides affordances that are about to
 * appear, instead of flashing ones the server would refuse.
 */
export function useRecruitmentUser(cycleId: string | null): RecruitmentStanding {
  const standing = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/me",
    { params: { path: { cycleId: cycleId ?? "" } } },
    { enabled: cycleId !== null, retry: false },
  );

  const data = standing.data;
  const memberships = data === undefined ? [] : data.memberships.map(toMembership);

  const user: RecruitmentUser = {
    id: data?.userId ?? "",
    role: toGlobalRole(data?.globalRole),
    recruitment: {
      cycleId,
      memberships,
      unblindedCandidacyIds: data?.unblindedCandidacyIds ?? [],
      blindReviewEnabled: data?.blindReviewEnabled ?? false,
    },
  };

  return {
    user,
    isLoaded: data !== undefined,
    hasNoAccess: standing.isError,
    isLeadership: memberships.some(
      (membership) =>
        membership.role === "committee_lead" || membership.role === "recruitment_admin",
    ),
    canDecideForCommittee: (committeeId: string) =>
      committeeId !== "" &&
      canDecideCommittee({ user, decision: { candidacyId: "", committeeId } }),
  };
}

/**
 * The caller with no cycle in view, built from the session alone.
 *
 * `/recruitment/cycles/{id}/me` is where the global role normally comes from,
 * and there is no cycle to ask it about on the cycle list - which is the one
 * screen where "create a cycle" belongs. Kept separate from
 * `useRecruitmentUser` deliberately: that hook is on every recruitment screen,
 * and giving all of them a session subscription they do not use made the
 * heaviest page measurably slower.
 */
export function useGlobalRecruitmentUser(): RecruitmentUser {
  const session = useSession();

  return {
    id: session.data?.user.id ?? "",
    role: toGlobalRole(session.data?.user.role),
    recruitment: {
      cycleId: null,
      memberships: [],
      unblindedCandidacyIds: [],
      blindReviewEnabled: false,
    },
  };
}

/**
 * The generated schema now carries `committeeId: string | null` and the role
 * union, so this is a straight pass-through. It stays as a named function
 * because it is the single place the wire shape becomes an access-control
 * `Membership`, and that is worth keeping obvious.
 */
function toMembership(row: { role: RecruitmentRole; committeeId: string | null }): Membership {
  return { role: row.role, committeeId: row.committeeId };
}

function toGlobalRole(role: Role | undefined): Role {
  return GLOBAL_ROLES.find((known) => known === role) ?? "guest";
}
