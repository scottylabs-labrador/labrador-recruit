import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { recruitmentCycle } from "./cycles.ts";
import { grantRole, grantScope } from "./enums.ts";

/**
 * A ScottyLabs committee, or a subteam of one.
 *
 * Global rather than per-cycle, so a committee keeps its identity across
 * seasons; its participation in one cycle is `recruitment_opening`.
 */
export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    /**
     * Optional parent, for a committee with subteams.
     *
     * A grant on a parent conveys **nothing** about a subteam, and a grant on a
     * subteam conveys nothing about its parent. Inheriting applicant visibility
     * down a tree is exactly the implicit widening the access model exists to
     * prevent, so the relationship here is structural only.
     *
     * Acyclicity is the service's job. Postgres will happily let two rows point
     * at each other.
     */
    parentTeamId: uuid("parent_team_id").references((): never => team.id as never, {
      onDelete: "restrict",
    }),

    /** Soft retirement. Never delete a team that has recruitment history. */
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("team_slug_key").on(table.slug),
    index("team_parentTeamId_idx").on(table.parentTeamId),
  ],
);

/**
 * Authority a person holds, in a scope, for a cycle.
 *
 * This is the whole authorization model. Authentication proves only that the
 * caller is some CMU affiliate — the realm brokers straight to CMU SAML, so
 * every Andrew ID authenticates successfully — so a row here is what turns an
 * account into a reviewer, a director, or an administrator.
 */
export const permissionGrant = pgTable(
  "permission_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: grantRole("role").notNull(),
    scope: grantScope("scope").notNull(),
    teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),

    /**
     * Null for a grant that is not tied to one cycle.
     *
     * Reviewer grants normally name one and expire with it, so somebody who
     * reviewed for Spring 2027 gains nothing in Fall 2027 by default. Cascading
     * on delete is deliberate: a grant scoped to a cycle that no longer exists
     * is authority with no window, which reads as nothing or everything
     * depending on which service asks.
     */
    cycleId: uuid("cycle_id").references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /**
     * Who issued it.
     *
     * Stored rather than merely audited, because the inviter's authority is
     * revalidated when an invitation is accepted. An invitation issued by
     * somebody whose own access has since been revoked must grant nothing, and
     * without this column there is no way to check.
     */
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),

    /** Null for no expiry. Reviewer grants normally expire with their cycle. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /** Set instead of deleting. The history is the audit trail. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "permission_grant_scope_team_ck",
      sql`(${table.scope} = 'organization' AND ${table.teamId} IS NULL)
          OR (${table.scope} = 'team' AND ${table.teamId} IS NOT NULL)`,
    ),

    // Live grants are deduplicated; revoked ones are not. Postgres treats NULLs
    // as distinct in a unique index, so each nullable combination needs its own
    // partial index or the duplicate it is meant to catch slips through.
    uniqueIndex("permission_grant_live_team_cycle_key")
      .on(table.userId, table.role, table.teamId, table.cycleId)
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.teamId} IS NOT NULL AND ${table.cycleId} IS NOT NULL`,
      ),
    uniqueIndex("permission_grant_live_team_key")
      .on(table.userId, table.role, table.teamId)
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.teamId} IS NOT NULL AND ${table.cycleId} IS NULL`,
      ),
    uniqueIndex("permission_grant_live_org_cycle_key")
      .on(table.userId, table.role, table.cycleId)
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.teamId} IS NULL AND ${table.cycleId} IS NOT NULL`,
      ),
    uniqueIndex("permission_grant_live_org_key")
      .on(table.userId, table.role)
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.teamId} IS NULL AND ${table.cycleId} IS NULL`,
      ),

    index("permission_grant_userId_idx").on(table.userId),
    index("permission_grant_teamId_idx").on(table.teamId),
    index("permission_grant_cycleId_idx").on(table.cycleId),
  ],
);

/**
 * A pending offer of authority, which the recipient must explicitly accept.
 *
 * Nobody is granted anything they did not accept, and the offer is revocable
 * until they do.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The intended recipient.
     *
     * Checked against the accepting account's verified email at acceptance. A
     * forwarded link must not grant access to whoever happened to open it.
     */
    email: text("email").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),

    cycleId: uuid("cycle_id").references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /**
     * A hash of the token. **The token itself is never stored.**
     *
     * So a database dump yields no working invitations. There is deliberately no
     * column the raw token could live in.
     */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Set in the same transaction that writes the grants. Single use. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("invitation_token_hash_key").on(table.tokenHash),
    index("invitation_email_idx").on(table.email),
    index("invitation_teamId_idx").on(table.teamId),
    index("invitation_cycleId_idx").on(table.cycleId),
  ],
);

/**
 * The roles one invitation offers, one row each.
 *
 * A separate table rather than a column, because a helper may be invited as
 * question editor and reviewer in the same act.
 */
export const invitationRole = pgTable(
  "invitation_role",
  {
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitation.id, { onDelete: "cascade" }),
    role: grantRole("role").notNull(),
  },
  (table) => [
    uniqueIndex("invitation_role_invitation_role_key").on(table.invitationId, table.role),
  ],
);

export const teamRelations = relations(team, ({ many }) => ({
  grants: many(permissionGrant),
}));

export const permissionGrantRelations = relations(permissionGrant, ({ one }) => ({
  user: one(user, { fields: [permissionGrant.userId], references: [user.id] }),
  team: one(team, { fields: [permissionGrant.teamId], references: [team.id] }),
}));

export const invitationRelations = relations(invitation, ({ one, many }) => ({
  inviter: one(user, { fields: [invitation.invitedBy], references: [user.id] }),
  team: one(team, { fields: [invitation.teamId], references: [team.id] }),
  roles: many(invitationRole),
}));

export const invitationRoleRelations = relations(invitationRole, ({ one }) => ({
  invitation: one(invitation, {
    fields: [invitationRole.invitationId],
    references: [invitation.id],
  }),
}));
