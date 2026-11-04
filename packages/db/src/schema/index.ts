export * from "./auth.ts";
export * from "./cycles.ts";
export * from "./enums.ts";
export * from "./org.ts";

import type { session, user } from "./auth.ts";
import type { recruitmentCycle, recruitmentOpening } from "./cycles.ts";
import type { invitation, invitationRole, permissionGrant, team } from "./org.ts";

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;

export type Team = typeof team.$inferSelect;
export type PermissionGrant = typeof permissionGrant.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type InvitationRole = typeof invitationRole.$inferSelect;

export type RecruitmentCycle = typeof recruitmentCycle.$inferSelect;
export type RecruitmentOpening = typeof recruitmentOpening.$inferSelect;
