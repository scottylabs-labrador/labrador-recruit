export * from "./applications.ts";
export * from "./audit.ts";
export * from "./auth.ts";
export * from "./decisions.ts";
export * from "./enums.ts";
export * from "./imports.ts";
export * from "./recruitment.ts";
export * from "./reviews.ts";

import type {
  applicant,
  application,
  applicationAnswer,
  committeeCandidacy,
  committeePreference,
  questionDefinition,
} from "./applications.ts";
import type { auditEvent } from "./audit.ts";
import type { committeeDecision, finalPlacement } from "./decisions.ts";
import type { importBatch, importRow } from "./imports.ts";
import type {
  committee,
  cycleCommittee,
  recruitmentCycle,
  recruitmentMembership,
} from "./recruitment.ts";
import type { review, reviewAssignment, reviewScore, rubric, rubricCriterion } from "./reviews.ts";

export type RecruitmentCycle = typeof recruitmentCycle.$inferSelect;
export type Committee = typeof committee.$inferSelect;
export type CycleCommittee = typeof cycleCommittee.$inferSelect;
export type RecruitmentMembership = typeof recruitmentMembership.$inferSelect;

export type Applicant = typeof applicant.$inferSelect;
export type Application = typeof application.$inferSelect;
export type QuestionDefinition = typeof questionDefinition.$inferSelect;
export type ApplicationAnswer = typeof applicationAnswer.$inferSelect;
export type CommitteePreference = typeof committeePreference.$inferSelect;
export type CommitteeCandidacy = typeof committeeCandidacy.$inferSelect;

export type Rubric = typeof rubric.$inferSelect;
export type RubricCriterion = typeof rubricCriterion.$inferSelect;
export type ReviewAssignment = typeof reviewAssignment.$inferSelect;
export type Review = typeof review.$inferSelect;
export type ReviewScore = typeof reviewScore.$inferSelect;

export type CommitteeDecision = typeof committeeDecision.$inferSelect;
export type FinalPlacement = typeof finalPlacement.$inferSelect;

export type ImportBatch = typeof importBatch.$inferSelect;
export type ImportRow = typeof importRow.$inferSelect;

export type AuditEvent = typeof auditEvent.$inferSelect;
