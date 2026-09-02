import type { RecruitmentUser } from "@labrador/access-control";
import { canConfigureCycle } from "@labrador/access-control";
import { committee, recruitmentMembership, user } from "@labrador/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";
import { recordAuditEvent } from "./auditService.ts";

export interface MembershipSummary {
  id: string;
  userId: string;
  userName: string;
  role: string;
  committeeId: string | null;
  committeeName: string | null;
  active: boolean;
}

export const membershipService = {
  /**
   * Who can do what in this cycle. Visible to anyone who may configure the
   * cycle, so a lead can see coverage before asking for more reviewers.
   */
  listMemberships: async (
    acUser: RecruitmentUser,
    cycleId: string,
  ): Promise<MembershipSummary[]> => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to manage this cycle's reviewers");
    }

    return db
      .select({
        id: recruitmentMembership.id,
        userId: recruitmentMembership.userId,
        userName: user.name,
        role: recruitmentMembership.role,
        committeeId: recruitmentMembership.committeeId,
        committeeName: committee.name,
        active: recruitmentMembership.active,
      })
      .from(recruitmentMembership)
      .innerJoin(user, eq(recruitmentMembership.userId, user.id))
      .leftJoin(committee, eq(recruitmentMembership.committeeId, committee.id))
      .where(eq(recruitmentMembership.cycleId, cycleId))
      .orderBy(asc(user.name));
  },

  /**
   * Grants a recruitment role.
   *
   * The user must already exist, which in production means they have signed in
   * through Keycloak at least once. Creating a user here would let an admin
   * invent an identity that no longer maps to a real Andrew ID.
   */
  grantMembership: async (
    acUser: RecruitmentUser,
    cycleId: string,
    input: {
      userId: string;
      role: "reviewer" | "committee_lead" | "recruitment_admin";
      committeeId?: string | null;
    },
  ) => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to manage this cycle's reviewers");
    }

    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, input.userId));

    if (!target) {
      throw new HttpError(
        404,
        "No such user. They must sign in once before they can be given a recruitment role.",
      );
    }

    // A recruitment admin is cycle-wide by definition; scoping one to a single
    // committee would silently create a role that behaves like neither.
    const committeeId = input.role === "recruitment_admin" ? null : (input.committeeId ?? null);

    if (input.role === "committee_lead" && committeeId === null) {
      throw new HttpError(422, "A committee lead must be scoped to a committee");
    }

    const now = new Date();

    // Granting a role somebody already holds is a normal thing for an admin to
    // do - two people set the cycle up, or a page is submitted twice. The
    // unique indexes turned that into a 500 from the database driver, which
    // reads as "the app is broken" rather than "they already have it".
    //
    // A revoked membership is reactivated rather than duplicated, because
    // revoking deactivates instead of deleting so that submitted reviews keep
    // a resolvable author. Inserting a second row would leave two.
    const [existing] = await db
      .select()
      .from(recruitmentMembership)
      .where(
        and(
          eq(recruitmentMembership.cycleId, cycleId),
          eq(recruitmentMembership.userId, input.userId),
          eq(recruitmentMembership.role, input.role),
          committeeId === null
            ? isNull(recruitmentMembership.committeeId)
            : eq(recruitmentMembership.committeeId, committeeId),
        ),
      );

    if (existing !== undefined) {
      if (existing.active) {
        return existing;
      }

      const [reactivated] = await db
        .update(recruitmentMembership)
        .set({ active: true, updatedAt: now })
        .where(eq(recruitmentMembership.id, existing.id))
        .returning();

      await recordAuditEvent({
        cycleId,
        actorUserId: acUser.id,
        action: "membership.granted",
        entityType: "recruitment_membership",
        entityId: existing.id,
        metadata: {
          userId: input.userId,
          role: input.role,
          committeeId,
          reactivated: true,
        },
      });

      return reactivated;
    }

    const [created] = await db
      .insert(recruitmentMembership)
      .values({
        cycleId,
        userId: input.userId,
        role: input.role,
        committeeId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await recordAuditEvent({
      cycleId,
      actorUserId: acUser.id,
      action: "membership.granted",
      entityType: "recruitment_membership",
      entityId: created?.id ?? null,
      metadata: { userId: input.userId, role: input.role, committeeId },
    });

    return created;
  },

  /** The cycle a membership belongs to, so the caller can be scoped to it. */
  getCycleIdForMembership: async (membershipId: string): Promise<string | null> => {
    const [row] = await db
      .select({ cycleId: recruitmentMembership.cycleId })
      .from(recruitmentMembership)
      .where(eq(recruitmentMembership.id, membershipId));
    return row?.cycleId ?? null;
  },

  /**
   * Deactivates a membership rather than deleting it, so reviews the person
   * already submitted keep a resolvable author.
   */
  revokeMembership: async (acUser: RecruitmentUser, membershipId: string): Promise<void> => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to manage this cycle's reviewers");
    }

    const [existing] = await db
      .select({ id: recruitmentMembership.id, cycleId: recruitmentMembership.cycleId })
      .from(recruitmentMembership)
      .where(eq(recruitmentMembership.id, membershipId));

    if (!existing) {
      throw new HttpError(404, "Membership not found");
    }

    await db
      .update(recruitmentMembership)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(recruitmentMembership.id, membershipId));

    await recordAuditEvent({
      cycleId: existing.cycleId,
      actorUserId: acUser.id,
      action: "membership.revoked",
      entityType: "recruitment_membership",
      entityId: membershipId,
      metadata: {},
    });
  },

  /** Candidate reviewers for a committee, used by the assignment interface. */
  listEligibleReviewers: async (acUser: RecruitmentUser, cycleId: string, committeeId: string) => {
    if (!canConfigureCycle({ user: acUser })) {
      throw new HttpError(403, "You are not allowed to view reviewers");
    }

    const rows = await db
      .select({
        userId: recruitmentMembership.userId,
        userName: user.name,
        role: recruitmentMembership.role,
        committeeId: recruitmentMembership.committeeId,
      })
      .from(recruitmentMembership)
      .innerJoin(user, eq(recruitmentMembership.userId, user.id))
      .where(
        and(eq(recruitmentMembership.cycleId, cycleId), eq(recruitmentMembership.active, true)),
      )
      .orderBy(asc(user.name));

    // A cycle-wide membership covers every committee.
    return rows.filter((row) => row.committeeId === null || row.committeeId === committeeId);
  },
};
