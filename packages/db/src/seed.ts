/**
 * Seed a complete, synthetic recruitment cycle for local development.
 *
 * Every applicant here is invented. Never seed a database from a real
 * application export, and never commit one to the repository.
 *
 * Run: bun run db:seed
 */
import { createDb, type Database } from "./index.ts";
import {
  applicant,
  application,
  committee,
  committeeCandidacy,
  committeePreference,
  cycleCommittee,
  recruitmentCycle,
  recruitmentMembership,
  reviewAssignment,
  rubric,
  rubricCriterion,
  user,
} from "./schema/index.ts";

const CYCLE_SLUG = "fall-2026";

/** Rank label to numeric rank, matching the form's own wording. */
const RANK_LABELS = [
  "1st Choice",
  "2nd Choice",
  "3rd Choice",
  "4th Choice",
  "5th Choice",
  "6th Choice",
  "7th Choice",
];

const COMMITTEES = [
  { slug: "tech", name: "Tech", capacity: 20 },
  { slug: "labrador", name: "Labrador", capacity: 15 },
  { slug: "design", name: "Design", capacity: 8 },
  { slug: "foundry", name: "Foundry", capacity: 10 },
  { slug: "finance", name: "Finance", capacity: 8 },
  { slug: "events", name: "Events", capacity: 10 },
  { slug: "outreach", name: "Outreach", capacity: 8 },
];

/** The default rubric. Weights are fractions of 1 and must sum to exactly 1. */
const CRITERIA = [
  {
    key: "interest",
    label: "Interest & Passion",
    description: "Genuine interest in ScottyLabs and this specific committee.",
    weight: "0.3000",
    source: "reviewer" as const,
  },
  {
    key: "initiative",
    label: "Initiative / Evidence of Action",
    description: "Evidence that they act on their interests and pursue things independently.",
    weight: "0.2000",
    source: "reviewer" as const,
  },
  {
    key: "ideas",
    label: "Ideas & Potential Contributions",
    description: "Thoughtfulness and usefulness of the ideas they want to contribute.",
    weight: "0.2000",
    source: "reviewer" as const,
  },
  {
    key: "experience",
    label: "Relevant Experience / Readiness",
    description: "Experience relevant to this committee.",
    weight: "0.1500",
    source: "reviewer" as const,
  },
  {
    key: "growth",
    label: "Growth Potential",
    description: "Curiosity, willingness to learn, and potential to develop.",
    weight: "0.1000",
    source: "reviewer" as const,
  },
  {
    key: "preference",
    label: "Applicant Committee Preference",
    description: "Derived from the ranking the applicant submitted. Not a human judgement.",
    weight: "0.0500",
    source: "application_preference" as const,
  },
];

/** Reviewers. Ids are Andrew IDs, matching what Better Auth assigns in production. */
const STAFF = [
  { id: "radmin", name: "Robin Admin", role: "recruitment_admin" as const, committee: null },
  { id: "techlead", name: "Tessa Lead", role: "committee_lead" as const, committee: "tech" },
  { id: "lablead", name: "Lars Lead", role: "committee_lead" as const, committee: "labrador" },
  { id: "rev1", name: "Rae Reviewer", role: "reviewer" as const, committee: "tech" },
  { id: "rev2", name: "Ravi Reviewer", role: "reviewer" as const, committee: "tech" },
  { id: "rev3", name: "Rosa Reviewer", role: "reviewer" as const, committee: "tech" },
  { id: "rev4", name: "Remy Reviewer", role: "reviewer" as const, committee: "labrador" },
  { id: "rev5", name: "Rin Reviewer", role: "reviewer" as const, committee: "labrador" },
];

/** Wholly invented applicants. Preferences are committee slugs in rank order. */
const APPLICANTS = [
  { name: "Ada Placeholder", year: "first_year", prefs: ["tech", "labrador", "design"] },
  { name: "Bo Placeholder", year: "first_year", prefs: ["tech", "foundry", "labrador"] },
  { name: "Cyd Placeholder", year: "sophomore", prefs: ["labrador", "tech", "events"] },
  { name: "Dee Placeholder", year: "first_year", prefs: ["design", "tech", "outreach"] },
  { name: "Eli Placeholder", year: "junior", prefs: ["finance", "foundry", "tech"] },
  { name: "Fay Placeholder", year: "sophomore", prefs: ["tech", "design", "labrador"] },
  { name: "Gus Placeholder", year: "first_year", prefs: ["events", "outreach", "tech"] },
  { name: "Hal Placeholder", year: "grad", prefs: ["foundry", "finance", "labrador"] },
  { name: "Ida Placeholder", year: "sophomore", prefs: ["labrador", "design", "tech"] },
  { name: "Jem Placeholder", year: "first_year", prefs: ["tech", "labrador", "foundry"] },
  { name: "Kit Placeholder", year: "senior", prefs: ["outreach", "events", "design"] },
  { name: "Lou Placeholder", year: "first_year", prefs: ["tech", "events", "finance"] },
] as const;

export interface SeedSummary {
  cycleId: string;
  staffCount: number;
  committeeCount: number;
  applicantCount: number;
  candidacyCount: number;
  assignmentCount: number;
}

/**
 * Populates a database with the synthetic cycle above.
 *
 * Takes the database rather than creating one so the seed can be exercised
 * against PGlite in tests, which is the only way to prove it still works
 * without a running Postgres.
 */
export async function seedRecruitmentData(
  db: Pick<Database, "insert">,
  now: Date = new Date(),
): Promise<SeedSummary> {
  const staffRows = await db
    .insert(user)
    .values(
      STAFF.map((person) => ({
        id: person.id,
        name: person.name,
        email: `${person.id}@andrew.cmu.edu`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning();

  const [cycle] = await db
    .insert(recruitmentCycle)
    .values({
      slug: CYCLE_SLUG,
      name: "Fall 2026",
      status: "reviewing",
      minimumReviews: 3,
      candidacyTopN: 3,
      preferenceScoreMap: { "1": 5, "2": 4.5, "3": 4, "4": 3, "5": 2.5, "6": 2, "7": 1 },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!cycle) {
    throw new Error("Failed to create the recruitment cycle");
  }

  const committeeRows = await db
    .insert(committee)
    .values(
      COMMITTEES.map((entry, index) => ({
        slug: entry.slug,
        name: entry.name,
        displayOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();

  const bySlug = new Map(committeeRows.map((row) => [row.slug, row]));

  await db.insert(cycleCommittee).values(
    COMMITTEES.map((entry) => {
      const row = bySlug.get(entry.slug);
      if (!row) throw new Error(`Missing committee ${entry.slug}`);
      return {
        cycleId: cycle.id,
        committeeId: row.id,
        capacity: entry.capacity,
        createdAt: now,
        updatedAt: now,
      };
    }),
  );

  await db.insert(recruitmentMembership).values(
    STAFF.map((person) => ({
      cycleId: cycle.id,
      userId: person.id,
      role: person.role,
      committeeId: person.committee ? (bySlug.get(person.committee)?.id ?? null) : null,
      createdAt: now,
      updatedAt: now,
    })),
  );

  const [rubricRow] = await db
    .insert(rubric)
    .values({
      cycleId: cycle.id,
      version: 1,
      name: "Fall 2026 default rubric",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!rubricRow) {
    throw new Error("Failed to create the rubric");
  }

  await db.insert(rubricCriterion).values(
    CRITERIA.map((criterion, index) => ({
      rubricId: rubricRow.id,
      key: criterion.key,
      label: criterion.label,
      description: criterion.description,
      weight: criterion.weight,
      source: criterion.source,
      displayOrder: index,
      createdAt: now,
      updatedAt: now,
    })),
  );

  let candidacyCount = 0;
  let assignmentCount = 0;

  for (const [index, person] of APPLICANTS.entries()) {
    const email = `applicant${index + 1}@andrew.cmu.edu`;

    const [applicantRow] = await db
      .insert(applicant)
      .values({
        email,
        rawEmail: email,
        fullName: person.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!applicantRow) throw new Error(`Failed to create applicant ${person.name}`);

    const [applicationRow] = await db
      .insert(application)
      .values({
        cycleId: cycle.id,
        applicantId: applicantRow.id,
        year: person.year,
        major: "Undeclared",
        rankingExplanation: `Synthetic seed row for ${person.name}.`,
        rawResponse: { seeded: true },
        submittedAt: now,
        sourceRowNumber: index + 2,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!applicationRow) throw new Error(`Failed to create application for ${person.name}`);

    // Rank every committee: the three stated preferences first, then the rest,
    // because the real form makes applicants rank all seven.
    const ranked = [
      ...person.prefs,
      ...COMMITTEES.map((c) => c.slug).filter((s) => !person.prefs.includes(s as never)),
    ];

    await db.insert(committeePreference).values(
      ranked.map((slug, rankIndex) => {
        const row = bySlug.get(slug);
        if (!row) throw new Error(`Missing committee ${slug}`);
        return {
          applicationId: applicationRow.id,
          committeeId: row.id,
          rank: rankIndex + 1,
          rawRankLabel: RANK_LABELS[rankIndex] ?? null,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );

    // Candidacies for the applicant's top three, matching the cycle default.
    for (const slug of person.prefs) {
      const committeeRow = bySlug.get(slug);
      if (!committeeRow) continue;

      const [candidacy] = await db
        .insert(committeeCandidacy)
        .values({
          applicationId: applicationRow.id,
          committeeId: committeeRow.id,
          source: "top_preference",
          status: "in_review",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!candidacy) continue;
      candidacyCount += 1;

      // Three reviewers drawn from that committee's pool, rotated so the load
      // spreads evenly across the seeded staff. The recruitment admin holds a
      // cycle-wide membership with a null committee, so matching on the slug
      // already excludes them.
      const pool = STAFF.filter((member) => member.committee === slug);
      if (pool.length === 0) continue;

      const chosen = [0, 1, 2]
        .map((offset) => pool[(index + offset) % pool.length])
        .filter((value, position, all) => value !== undefined && all.indexOf(value) === position);

      for (const reviewer of chosen) {
        if (!reviewer) continue;
        await db.insert(reviewAssignment).values({
          candidacyId: candidacy.id,
          reviewerUserId: reviewer.id,
          assignedAt: now,
          createdBy: "radmin",
          createdAt: now,
          updatedAt: now,
        });
        assignmentCount += 1;
      }
    }
  }

  return {
    cycleId: cycle.id,
    staffCount: staffRows.length || STAFF.length,
    committeeCount: committeeRows.length,
    applicantCount: APPLICANTS.length,
    candidacyCount,
    assignmentCount,
  };
}

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(databaseUrl);
  const summary = await seedRecruitmentData(db);

  console.log(
    [
      `Seeded cycle ${CYCLE_SLUG}`,
      `  ${summary.staffCount} staff users`,
      `  ${summary.committeeCount} committees`,
      `  ${CRITERIA.length} rubric criteria`,
      `  ${summary.applicantCount} synthetic applicants`,
      `  ${summary.candidacyCount} candidacies`,
      `  ${summary.assignmentCount} review assignments`,
    ].join("\n"),
  );

  await db.$client.end();
}

// Only run when invoked directly, so importing this module in a test is safe.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
