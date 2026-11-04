/**
 * Synthetic development data for one complete recruitment cycle.
 *
 * Every workstream develops against this, so its shape is a contract — see
 * `test/seed.test.ts` for what callers may rely on.
 *
 * Two properties are deliberate and tested:
 *
 * - **Deterministic.** Fixed ids and fixed content, so a failing test is
 *   reproducible. No random names, no random uuids where a stable one will do.
 * - **Re-runnable.** It truncates first. v1's seed created its cycle outright
 *   and died on the slug's unique constraint, which meant dropping the whole
 *   database to re-seed. Nobody should have to learn that twice.
 *
 * Everything here is invented. **Never put real applicant data in this file** —
 * `docs/product-rules.md` section 6. The essays are deliberately bland so that
 * nobody mistakes one for a real submission.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  answer,
  application,
  applicationStatusEvent,
  candidateProfile,
  form,
  formResponse,
  formVersion,
  permissionGrant,
  question,
  recruitmentCycle,
  recruitmentOpening,
  review,
  reviewAssignment,
  reviewScore,
  rubric,
  rubricCriterion,
  team,
  user,
} from "./schema/index.ts";

/** Fixed, so ids are stable across runs and a failing test is reproducible. */
const CREATED_AT = new Date("2026-11-01T12:00:00Z");
const OPENS_AT = new Date("2027-01-15T12:00:00Z");
const CLOSES_AT = new Date("2027-02-15T12:00:00Z");

const STAFF = [
  { id: "dchen", name: "Dana Chen", role: "org_admin" as const, team: null },
  { id: "mokafor", name: "Miriam Okafor", role: "committee_director" as const, team: "labrador" },
  { id: "jtanaka", name: "Jun Tanaka", role: "committee_director" as const, team: "design" },
  { id: "pvarma", name: "Priya Varma", role: "question_editor" as const, team: "labrador" },
  { id: "lhaddad", name: "Layla Haddad", role: "reviewer" as const, team: "labrador" },
  { id: "osorensen", name: "Ola Sorensen", role: "reviewer" as const, team: "labrador" },
  { id: "rmbeki", name: "Ruth Mbeki", role: "reviewer" as const, team: "design" },
];

const APPLICANTS = [
  { id: "aquinn", name: "Avery Quinn", major: "Computer Science", year: 2029 },
  { id: "bmorales", name: "Blair Morales", major: "Design", year: 2028 },
  { id: "cokonkwo", name: "Chidi Okonkwo", major: "Information Systems", year: 2029 },
  { id: "dlindqvist", name: "Dag Lindqvist", major: "Statistics", year: 2027 },
  { id: "efitzgerald", name: "Eilish Fitzgerald", major: "Computer Science", year: 2030 },
  { id: "fnakamura", name: "Fumiko Nakamura", major: "Human-Computer Interaction", year: 2028 },
  { id: "gadeyemi", name: "Gbemi Adeyemi", major: "Electrical Engineering", year: 2029 },
  { id: "hpetrov", name: "Hana Petrov", major: "Mathematics", year: 2027 },
  { id: "ireyes", name: "Ines Reyes", major: "Design", year: 2030 },
  { id: "jsvensson", name: "Johan Svensson", major: "Computer Science", year: 2028 },
  { id: "kbanerjee", name: "Kiran Banerjee", major: "Business Administration", year: 2029 },
  { id: "lmwangi", name: "Lydia Mwangi", major: "Computer Science", year: 2028 },
];

/**
 * The statuses to spread applications across.
 *
 * Every screen somebody is about to build needs at least one row in its own
 * state, so the list is exhaustive rather than representative.
 */
const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "submitted",
  "under_review",
  "under_review",
  "shortlisted",
  "withdrawn",
] as const;

const COMMON_QUESTIONS = [
  {
    questionKey: "full-name",
    type: "short_text" as const,
    label: "Full name",
    required: true,
  },
  {
    questionKey: "major",
    type: "short_text" as const,
    label: "What is your major?",
    required: true,
  },
  {
    questionKey: "graduation-year",
    type: "number" as const,
    label: "Expected graduation year",
    required: true,
  },
  {
    questionKey: "interest-area",
    type: "single_select" as const,
    label: "Which area interests you most?",
    required: true,
    configJson: {
      choices: ["Software", "Design", "AI / Machine Learning", "Operations"],
    },
  },
  {
    questionKey: "ai-project",
    type: "long_text" as const,
    label: "Describe an AI-related project you have worked on.",
    required: true,
    /**
     * The conditional question the renderer and the evaluator develop against.
     *
     * Structured data, never code. It references `interest-area`, which sits
     * earlier in position order — a forward reference could not be resolved in
     * the single pass the evaluator makes, and is refused at publish time.
     */
    visibilityRuleJson: {
      equals: { questionKey: "interest-area", value: "AI / Machine Learning" },
    },
  },
  {
    questionKey: "motivation",
    type: "long_text" as const,
    label: "Why do you want to join ScottyLabs?",
    required: true,
  },
  {
    questionKey: "github",
    type: "url" as const,
    label: "GitHub profile, if you have one",
    required: false,
  },
];

const CRITERIA = [
  { name: "Motivation", position: 1 },
  { name: "Relevant Experience", position: 2 },
  { name: "Interest in Committee", position: 3 },
  { name: "Collaboration", position: 4 },
];

/**
 * Any drizzle Postgres instance.
 *
 * Written against the shared base rather than one driver, so the same seed runs
 * against PGlite in the test suite and against a real Postgres from the command
 * line. Those two have different driver types and are otherwise incompatible.
 */
type SeedDatabase = PgDatabase<PgQueryResultHKT>;

/**
 * Empties every table, discovered from the catalogue.
 *
 * A hand-maintained list is the thing somebody forgets when they add a table,
 * and the symptom is a seed that half-succeeds.
 */
async function truncateAll(db: SeedDatabase): Promise<void> {
  const result = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);
  // `execute` is typed loosely across drivers, so the row shape is asserted once
  // here rather than threaded through a generic the two drivers disagree about.
  const rows = (result as { rows: { tablename: string }[] }).rows;
  const names = rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names.length > 0) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`));
  }
}

export async function seedDevelopmentData(db: SeedDatabase): Promise<void> {
  await truncateAll(db);

  const everyone = [...STAFF, ...APPLICANTS];
  await db.insert(user).values(
    everyone.map((person) => ({
      id: person.id,
      name: person.name,
      email: `${person.id}@andrew.cmu.edu`,
      emailVerified: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })),
  );

  const [cycle] = await db
    .insert(recruitmentCycle)
    .values({
      slug: "spring-2027",
      name: "Spring 2027",
      description: "Spring 2027 recruitment for every participating committee.",
      status: "open",
      timeZone: "America/New_York",
      opensAt: OPENS_AT,
      closesAt: CLOSES_AT,
      maxCommitteesPerApplicant: 3,
      requirePreferenceRanking: true,
      createdBy: "dchen",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .returning({ id: recruitmentCycle.id });
  const cycleId = cycle!.id;

  const [labrador] = await db
    .insert(team)
    .values({
      slug: "labrador",
      name: "Labrador",
      description: "Product teams building for the CMU community.",
      displayOrder: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .returning({ id: team.id });
  const [design] = await db
    .insert(team)
    .values({
      slug: "design",
      name: "Design",
      description: "Brand, product design, and the design system.",
      displayOrder: 2,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .returning({ id: team.id });

  // A subteam, so the parent/child grant rules have something real to run
  // against: a grant on Labrador must convey nothing about Labrador Infra.
  await db.insert(team).values({
    slug: "labrador-infra",
    name: "Labrador Infrastructure",
    description: "Deployment, observability, and developer tooling.",
    parentTeamId: labrador!.id,
    displayOrder: 3,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });

  const teamIds: Record<string, string> = { labrador: labrador!.id, design: design!.id };

  const openings: { id: string; teamSlug: string }[] = [];
  for (const slug of ["labrador", "design"]) {
    const [opening] = await db
      .insert(recruitmentOpening)
      .values({
        cycleId,
        teamId: teamIds[slug]!,
        status: "open",
        capacity: 8,
        minimumReviews: 2,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: recruitmentOpening.id });
    openings.push({ id: opening!.id, teamSlug: slug });
  }

  await db.insert(permissionGrant).values(
    STAFF.map((person) => ({
      userId: person.id,
      role: person.role,
      scope: person.team === null ? ("organization" as const) : ("team" as const),
      teamId: person.team === null ? null : teamIds[person.team]!,
      cycleId: person.role === "org_admin" ? null : cycleId,
      grantedBy: "dchen",
      createdAt: CREATED_AT,
    })),
  );

  // The common form, published, with the conditional question.
  const [commonForm] = await db
    .insert(form)
    .values({
      cycleId,
      kind: "common",
      title: "ScottyLabs Common Application",
      description: "Answered once. Every committee you apply to sees these answers.",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .returning({ id: form.id });
  const [commonVersion] = await db
    .insert(formVersion)
    .values({
      formId: commonForm!.id,
      version: 1,
      status: "published",
      publishedAt: CREATED_AT,
      createdBy: "dchen",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .returning({ id: formVersion.id });
  const commonVersionId = commonVersion!.id;

  const commonQuestionIds: Record<string, string> = {};
  for (const [index, spec] of COMMON_QUESTIONS.entries()) {
    const [row] = await db
      .insert(question)
      .values({ ...spec, formVersionId: commonVersionId, position: index + 1 })
      .returning({ id: question.id });
    commonQuestionIds[spec.questionKey] = row!.id;
  }

  // One committee form per opening, published.
  const committeeVersions: Record<string, { versionId: string; questionId: string }> = {};
  for (const opening of openings) {
    const [committeeForm] = await db
      .insert(form)
      .values({
        cycleId,
        teamId: teamIds[opening.teamSlug]!,
        openingId: opening.id,
        kind: "committee",
        title: `${opening.teamSlug === "labrador" ? "Labrador" : "Design"} Application`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: form.id });
    const [version] = await db
      .insert(formVersion)
      .values({
        formId: committeeForm!.id,
        version: 1,
        status: "published",
        publishedAt: CREATED_AT,
        createdBy: opening.teamSlug === "labrador" ? "mokafor" : "jtanaka",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: formVersion.id });
    const [committeeQuestion] = await db
      .insert(question)
      .values({
        formVersionId: version!.id,
        questionKey: "why-this-committee",
        type: "long_text",
        label: `Why this committee in particular?`,
        required: true,
        position: 1,
      })
      .returning({ id: question.id });
    committeeVersions[opening.teamSlug] = {
      versionId: version!.id,
      questionId: committeeQuestion!.id,
    };
  }

  // A rubric per opening.
  const rubricIds: Record<string, { rubricId: string; criterionIds: string[] }> = {};
  for (const opening of openings) {
    const [row] = await db
      .insert(rubric)
      .values({
        openingId: opening.id,
        version: 1,
        status: "active",
        createdBy: opening.teamSlug === "labrador" ? "mokafor" : "jtanaka",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: rubric.id });
    const criterionIds: string[] = [];
    for (const criterion of CRITERIA) {
      const [inserted] = await db
        .insert(rubricCriterion)
        .values({
          rubricId: row!.id,
          name: criterion.name,
          minimumScore: 1,
          maximumScore: 5,
          position: criterion.position,
        })
        .returning({ id: rubricCriterion.id });
      criterionIds.push(inserted!.id);
    }
    rubricIds[opening.teamSlug] = { rubricId: row!.id, criterionIds };
  }

  // Applicants: a profile, a common response, and one or two applications each.
  const reviewableApplications: { id: string; teamSlug: string }[] = [];

  for (const [index, applicant] of APPLICANTS.entries()) {
    const status = APPLICATION_STATUSES[index % APPLICATION_STATUSES.length]!;
    const isFinal = status !== "draft";

    const [profile] = await db
      .insert(candidateProfile)
      .values({
        userId: applicant.id,
        cycleId,
        commonLockedAt: isFinal ? CREATED_AT : null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: candidateProfile.id });

    const [commonResponse] = await db
      .insert(formResponse)
      .values({
        formVersionId: commonVersionId,
        candidateProfileId: profile!.id,
        status: isFinal ? "submitted" : "draft",
        submittedAt: isFinal ? CREATED_AT : null,
        revision: isFinal ? 3 : 1,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .returning({ id: formResponse.id });

    const interestArea = index % 3 === 0 ? "AI / Machine Learning" : "Software";
    const commonAnswers: { questionKey: string; value: unknown }[] = [
      { questionKey: "full-name", value: applicant.name },
      { questionKey: "major", value: applicant.major },
      { questionKey: "graduation-year", value: applicant.year },
      { questionKey: "interest-area", value: interestArea },
      { questionKey: "motivation", value: `${applicant.name} would like to build things here.` },
      { questionKey: "github", value: `https://github.com/example-${applicant.id}` },
    ];
    // The conditional answer exists only where the rule says the question is
    // visible, which is the state the submission validator has to handle.
    if (interestArea === "AI / Machine Learning") {
      commonAnswers.push({
        questionKey: "ai-project",
        value: "A classifier for an undergraduate course project.",
      });
    }

    await db.insert(answer).values(
      commonAnswers.map((entry) => ({
        formResponseId: commonResponse!.id,
        formVersionId: commonVersionId,
        questionId: commonQuestionIds[entry.questionKey]!,
        valueJsonb: entry.value,
        updatedAt: CREATED_AT,
      })),
    );

    // Everybody applies to Labrador; every third applicant also applies to
    // Design, so one person holding two applications is represented.
    const targets = index % 3 === 0 ? ["labrador", "design"] : ["labrador"];
    for (const [rank, teamSlug] of targets.entries()) {
      const opening = openings.find((o) => o.teamSlug === teamSlug)!;
      const [app] = await db
        .insert(application)
        .values({
          candidateProfileId: profile!.id,
          openingId: opening.id,
          status,
          preferenceRank: rank + 1,
          submittedAt: isFinal ? CREATED_AT : null,
          withdrawnAt: status === "withdrawn" ? CREATED_AT : null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        })
        .returning({ id: application.id });

      const committee = committeeVersions[teamSlug]!;
      const [committeeResponse] = await db
        .insert(formResponse)
        .values({
          formVersionId: committee.versionId,
          applicationId: app!.id,
          status: isFinal ? "submitted" : "draft",
          submittedAt: isFinal ? CREATED_AT : null,
          revision: isFinal ? 2 : 1,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        })
        .returning({ id: formResponse.id });
      await db.insert(answer).values({
        formResponseId: committeeResponse!.id,
        formVersionId: committee.versionId,
        questionId: committee.questionId,
        valueJsonb: `${applicant.name} is interested in this committee's work.`,
        updatedAt: CREATED_AT,
      });

      if (isFinal) {
        await db.insert(applicationStatusEvent).values({
          applicationId: app!.id,
          oldStatus: "draft",
          newStatus: "submitted",
          event: "submitted",
          createdAt: CREATED_AT,
        });
      }
      if (status === "under_review" || status === "shortlisted") {
        reviewableApplications.push({ id: app!.id, teamSlug });
      }
    }
  }

  /*
   * Reviews, deliberately in both states.
   *
   * Track B needs a submitted review and an unsubmitted one to see the
   * unblinding rule work — a reviewer sees peers only once their own review is
   * submitted — without writing fixtures of their own.
   */
  const reviewersByTeam: Record<string, string[]> = {
    labrador: ["lhaddad", "osorensen"],
    design: ["rmbeki"],
  };

  for (const [index, target] of reviewableApplications.entries()) {
    const reviewers = reviewersByTeam[target.teamSlug]!;
    for (const [offset, reviewerId] of reviewers.entries()) {
      const [assignment] = await db
        .insert(reviewAssignment)
        .values({
          applicationId: target.id,
          reviewerId,
          assignedBy: target.teamSlug === "labrador" ? "mokafor" : "jtanaka",
          status: (index + offset) % 2 === 0 ? "submitted" : "in_progress",
          assignedAt: CREATED_AT,
        })
        .returning({ id: reviewAssignment.id });

      const isSubmitted = (index + offset) % 2 === 0;
      const { rubricId, criterionIds } = rubricIds[target.teamSlug]!;
      const [reviewRow] = await db
        .insert(review)
        .values({
          assignmentId: assignment!.id,
          rubricId,
          status: isSubmitted ? "submitted" : "draft",
          recommendation: isSubmitted ? "yes" : null,
          confidence: isSubmitted ? "medium" : null,
          comments: isSubmitted ? "Clear motivation, some relevant experience." : null,
          submittedAt: isSubmitted ? CREATED_AT : null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        })
        .returning({ id: review.id });

      if (isSubmitted) {
        await db.insert(reviewScore).values(
          criterionIds.map((criterionId, position) => ({
            reviewId: reviewRow!.id,
            rubricId,
            criterionId,
            // Fixed per position rather than random, so an aggregate a developer
            // computes by hand matches what the platform reports.
            score: 3 + ((position + index) % 3),
          })),
        );
      }
    }
  }
}
