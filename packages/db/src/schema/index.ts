export * from "./applications.ts";
export * from "./auth.ts";
export * from "./cycles.ts";
export * from "./enums.ts";
export * from "./forms.ts";
export * from "./org.ts";
export * from "./records.ts";
export * from "./reviews.ts";

import type { answer, application, candidateProfile, formResponse } from "./applications.ts";
import type { session, user } from "./auth.ts";
import type { recruitmentCycle, recruitmentOpening } from "./cycles.ts";
import type { form, formVersion, question } from "./forms.ts";
import type { invitation, invitationRole, permissionGrant, team } from "./org.ts";
import type { applicationStatusEvent, auditEvent, file, notificationOutbox } from "./records.ts";
import type { review, reviewAssignment, reviewScore, rubric, rubricCriterion } from "./reviews.ts";

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;

export type Team = typeof team.$inferSelect;
export type PermissionGrant = typeof permissionGrant.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type InvitationRole = typeof invitationRole.$inferSelect;

export type Form = typeof form.$inferSelect;
export type FormVersion = typeof formVersion.$inferSelect;
export type Question = typeof question.$inferSelect;

export type CandidateProfile = typeof candidateProfile.$inferSelect;
export type Application = typeof application.$inferSelect;
export type FormResponse = typeof formResponse.$inferSelect;
export type Answer = typeof answer.$inferSelect;

export type RecruitmentCycle = typeof recruitmentCycle.$inferSelect;
export type RecruitmentOpening = typeof recruitmentOpening.$inferSelect;

export type Rubric = typeof rubric.$inferSelect;
export type RubricCriterion = typeof rubricCriterion.$inferSelect;
export type ReviewAssignment = typeof reviewAssignment.$inferSelect;
export type Review = typeof review.$inferSelect;
export type ReviewScore = typeof reviewScore.$inferSelect;

export type ApplicationStatusEvent = typeof applicationStatusEvent.$inferSelect;
export type File = typeof file.$inferSelect;
export type NotificationOutbox = typeof notificationOutbox.$inferSelect;
export type AuditEvent = typeof auditEvent.$inferSelect;
