import type { Membership, RecruitmentUser } from "@labrador/access-control";

import { useUser } from "@/hooks/useUser.ts";

interface RecruitmentUserOptions {
  cycleId: string | null;
  /** The cycle's blind-review setting, from `GET /recruitment/cycles/{cycleId}`. */
  blindReviewEnabled?: boolean | undefined;
  /** Candidacies where this reviewer has already submitted, so peers unblind. */
  unblindedCandidacyIds?: string[] | undefined;
  /** True once the caller is known to hold a membership in this cycle. */
  isMember?: boolean | undefined;
}

/**
 * Assembles the `RecruitmentUser` that `@labrador/access-control` predicates
 * take, so the browser asks the *same* questions the server asks rather than
 * reimplementing the rules.
 *
 * One caveat is worth stating plainly: the API exposes no endpoint returning the
 * caller's recruitment memberships, so the browser cannot know whether the
 * caller is a reviewer, a committee lead, or a recruitment admin. `GET
 * /recruitment/cycles` only returns cycles the caller holds *some* membership
 * in, so the least-privilege assumption — a cycle-wide `reviewer` — is the most
 * the browser can safely claim. Under-claiming is the safe direction: it can
 * only hide an affordance the server would have allowed, never reveal one it
 * would refuse. The server remains the enforcement point either way.
 */
export function useRecruitmentUser({
  cycleId,
  blindReviewEnabled,
  unblindedCandidacyIds,
  isMember = true,
}: RecruitmentUserOptions): RecruitmentUser {
  const user = useUser();

  const memberships: Membership[] =
    isMember && cycleId !== null && user.id !== "" ? [{ role: "reviewer", committeeId: null }] : [];

  return {
    ...user,
    recruitment: {
      cycleId,
      memberships,
      unblindedCandidacyIds: unblindedCandidacyIds ?? [],
      blindReviewEnabled: blindReviewEnabled ?? false,
    },
  };
}
