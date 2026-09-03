import {
  applicant,
  application,
  applicationAnswer,
  committee,
  committeeCandidacy,
  committeePreference,
  cycleCommittee,
  questionDefinition,
  recruitmentCycle,
  recruitmentMembership,
  review,
  reviewAssignment,
  rubric,
  rubricCriterion,
} from "@labrador/db/schema";

import { testDb } from "./harness.ts";

/** The seven ScottyLabs committees, in the order the form presents them. */
export const COMMITTEE_SLUGS = [
  "tech",
  "design",
  "finance",
  "events",
  "outreach",
  "labrador",
  "foundry",
] as const;

/** Maps a submitted rank to a 1-5 preference score. */
export const DEFAULT_PREFERENCE_MAP = {
  "1": 5,
  "2": 4.5,
  "3": 4,
  "4": 3,
  "5": 2.5,
  "6": 2,
  "7": 1,
};

export async function seedCycle(
  overrides: Partial<typeof recruitmentCycle.$inferInsert> = {},
): Promise<typeof recruitmentCycle.$inferSelect> {
  const now = new Date();
  const [row] = await testDb
    .insert(recruitmentCycle)
    .values({
      slug: "fall-2026",
      name: "Fall 2026",
      status: "open",
      preferenceScoreMap: DEFAULT_PREFERENCE_MAP,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed recruitment cycle");
  }
  return row;
}

export async function seedCommittees(): Promise<Record<string, typeof committee.$inferSelect>> {
  const now = new Date();
  const rows = await testDb
    .insert(committee)
    .values(
      COMMITTEE_SLUGS.map((slug, index) => ({
        slug,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        displayOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();

  return Object.fromEntries(rows.map((row) => [row.slug, row]));
}

export async function linkCommitteeToCycle(
  cycleId: string,
  committeeId: string,
  capacity: number | null = null,
) {
  const now = new Date();
  const [row] = await testDb
    .insert(cycleCommittee)
    .values({ cycleId, committeeId, capacity, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function seedApplicant(opts: { email: string; fullName: string }) {
  const now = new Date();
  const [row] = await testDb
    .insert(applicant)
    .values({
      email: opts.email.trim().toLowerCase(),
      rawEmail: opts.email,
      fullName: opts.fullName,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed applicant");
  }
  return row;
}

export async function seedApplication(opts: {
  cycleId: string;
  applicantId: string;
  year?: typeof application.$inferInsert.year;
  major?: string;
}) {
  const now = new Date();
  const [row] = await testDb
    .insert(application)
    .values({
      cycleId: opts.cycleId,
      applicantId: opts.applicantId,
      year: opts.year ?? "first_year",
      major: opts.major ?? "Computer Science",
      rawResponse: {},
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed application");
  }
  return row;
}

export async function seedPreference(opts: {
  applicationId: string;
  committeeId: string;
  rank: number;
}) {
  const now = new Date();
  const [row] = await testDb
    .insert(committeePreference)
    .values({
      applicationId: opts.applicationId,
      committeeId: opts.committeeId,
      rank: opts.rank,
      rawRankLabel: `${opts.rank} Choice`,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function seedCandidacy(opts: {
  applicationId: string;
  committeeId: string;
  source?: typeof committeeCandidacy.$inferInsert.source;
}) {
  const now = new Date();
  const [row] = await testDb
    .insert(committeeCandidacy)
    .values({
      applicationId: opts.applicationId,
      committeeId: opts.committeeId,
      source: opts.source ?? "top_preference",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed candidacy");
  }
  return row;
}

/** The default rubric from the leadership discussion: five human criteria plus preference. */
export const DEFAULT_CRITERIA = [
  { key: "interest", label: "Interest & Passion", weight: "0.3000", source: "reviewer" },
  { key: "initiative", label: "Initiative", weight: "0.2000", source: "reviewer" },
  { key: "ideas", label: "Ideas & Contributions", weight: "0.2000", source: "reviewer" },
  { key: "experience", label: "Relevant Experience", weight: "0.1500", source: "reviewer" },
  { key: "growth", label: "Growth Potential", weight: "0.1000", source: "reviewer" },
  {
    key: "preference",
    label: "Applicant Committee Preference",
    weight: "0.0500",
    source: "application_preference",
  },
] as const;

export async function seedRubric(opts: { cycleId: string; committeeId?: string | null }) {
  const now = new Date();
  const [rubricRow] = await testDb
    .insert(rubric)
    .values({
      cycleId: opts.cycleId,
      committeeId: opts.committeeId ?? null,
      version: 1,
      name: "Default rubric",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!rubricRow) {
    throw new Error("Failed to seed rubric");
  }

  const criteria = await testDb
    .insert(rubricCriterion)
    .values(
      DEFAULT_CRITERIA.map((criterion, index) => ({
        rubricId: rubricRow.id,
        key: criterion.key,
        label: criterion.label,
        weight: criterion.weight,
        source: criterion.source,
        displayOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();

  return { rubric: rubricRow, criteria };
}

export async function seedAssignment(opts: { candidacyId: string; reviewerUserId: string }) {
  const now = new Date();
  const [row] = await testDb
    .insert(reviewAssignment)
    .values({
      candidacyId: opts.candidacyId,
      reviewerUserId: opts.reviewerUserId,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed assignment");
  }
  return row;
}

export async function seedMembership(opts: {
  cycleId: string;
  userId: string;
  role: typeof recruitmentMembership.$inferInsert.role;
  committeeId?: string | null;
}) {
  const now = new Date();
  const [row] = await testDb
    .insert(recruitmentMembership)
    .values({
      cycleId: opts.cycleId,
      userId: opts.userId,
      role: opts.role,
      committeeId: opts.committeeId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function seedReview(opts: { assignmentId: string; rubricId: string }) {
  const now = new Date();
  const [row] = await testDb
    .insert(review)
    .values({
      assignmentId: opts.assignmentId,
      rubricId: opts.rubricId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to seed review");
  }
  return row;
}

/**
 * Gives an application a committee-scoped answer.
 *
 * The queue's priority order asks "did they write anything for this
 * committee", which is answered by joining `application_answer` to a
 * `question_definition` that carries a `committee_id` — so a fixture for it
 * has to create both.
 */
export async function seedCommitteeAnswer(opts: {
  cycleId: string;
  applicationId: string;
  committeeId: string;
  key?: string;
  answerText?: string | null;
}) {
  const now = new Date();
  const key = opts.key ?? `answer_${opts.committeeId.slice(0, 8)}`;

  const [question] = await testDb
    .insert(questionDefinition)
    .values({
      cycleId: opts.cycleId,
      externalHeader: `Why this committee? (${key})`,
      key,
      section: "committee",
      committeeId: opts.committeeId,
      questionText: "Why this committee?",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!question) {
    throw new Error("failed to seed question definition");
  }

  const [answer] = await testDb
    .insert(applicationAnswer)
    .values({
      applicationId: opts.applicationId,
      questionDefinitionId: question.id,
      answerText: opts.answerText === undefined ? "Because I want to." : opts.answerText,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { question, answer };
}
