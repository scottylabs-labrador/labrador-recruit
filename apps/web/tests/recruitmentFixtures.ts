import type { components, paths } from "@labrador/server/build/swagger";

/**
 * Synthetic recruitment fixtures. Shapes are taken straight from the generated
 * OpenAPI schemas so a contract change breaks the tests rather than drifting.
 * No real applicant data ever lives here.
 */

export type Cycle = components["schemas"]["CycleSummary"];
export type Committee = components["schemas"]["CommitteeSummary"];
export type QueueEntry = components["schemas"]["QueueItem"];
export type Review = components["schemas"]["ReviewDetail"];
export type Aggregate = components["schemas"]["CandidacyAggregate"];
export type RankingEntry = components["schemas"]["RankingRow"];
export type ApplicationDetail = components["schemas"]["ApplicationDetail"];
export type RubricCriterion = components["schemas"]["RubricCriterionSummary"];
export type PeerReview = components["schemas"]["CandidacyReviewSummary"];
export type MyStanding =
  paths["/recruitment/cycles/{cycleId}/me"]["get"]["responses"][200]["content"]["application/json"];
export type CycleProgress =
  paths["/recruitment/cycles/{cycleId}/progress"]["get"]["responses"][200]["content"]["application/json"];

export interface Rubric {
  id: string;
  name: string;
  version: number;
  criteria: RubricCriterion[];
}

export type Application = components["schemas"]["ApplicationListItem"] & {
  detail?: ApplicationDetail;
};

export const CYCLE_ID = "cycle-1";
export const COMMITTEE_TECH = "committee-tech";
export const COMMITTEE_DESIGN = "committee-design";
export const ASSIGNMENT_ID = "assignment-1";
export const CANDIDACY_ID = "candidacy-1";
export const APPLICATION_ID = "application-1";

export function cycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: CYCLE_ID,
    slug: "spring-2026",
    name: "Spring 2026",
    status: "reviewing",
    minimumReviews: 2,
    blindReviewEnabled: false,
    candidacyTopN: 2,
    disagreementSpreadThreshold: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function committee(overrides: Partial<Committee> = {}): Committee {
  return {
    id: COMMITTEE_TECH,
    slug: "tech",
    name: "Tech",
    capacity: 10,
    displayOrder: 1,
    ...overrides,
  };
}

export function queueEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    assignmentId: ASSIGNMENT_ID,
    candidacyId: CANDIDACY_ID,
    status: "assigned",
    committeeId: COMMITTEE_TECH,
    committeeName: "Tech",
    applicationId: APPLICATION_ID,
    applicantName: "Robin Fixture",
    year: "sophomore",
    major: "Information Systems",
    applicantRank: 1,
    hasDraft: false,
    submitted: false,
    ...overrides,
  };
}

export function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    assignmentId: ASSIGNMENT_ID,
    rubricId: "rubric-1",
    recommendation: null,
    confidence: null,
    rationale: null,
    privateNotes: null,
    discussionFlag: false,
    underratedFlag: false,
    computedScore: null,
    submittedAt: null,
    scores: [],
    ...overrides,
  };
}

export function rubric(overrides: Partial<Rubric> = {}): Rubric {
  return {
    id: "rubric-1",
    name: "Tech rubric",
    version: 1,
    criteria: [
      {
        id: "criterion-1",
        key: "technical_depth",
        label: "Technical depth",
        description: "How deeply did they engage with the technical prompt?",
        weight: 0.9,
        minScore: 1,
        maxScore: 5,
        source: "reviewer",
        displayOrder: 1,
      },
      {
        // A derived criterion. It is part of the rubric and part of the score,
        // but the reviewer never enters it, so the form must neither render it
        // as an input nor count it as missing.
        id: "criterion-preference",
        key: "preference",
        label: "Applicant Committee Preference",
        description: "Derived from the ranking the applicant submitted.",
        weight: 0.1,
        minScore: 1,
        maxScore: 5,
        source: "application_preference",
        displayOrder: 2,
      },
    ],
    ...overrides,
  };
}

export function applicationDetail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    applicationId: APPLICATION_ID,
    cycleId: CYCLE_ID,
    applicantName: "Robin Fixture",
    email: "robin@example.edu",
    year: "sophomore",
    rawYear: "Sophomore",
    major: "Information Systems",
    rankingExplanation: "Tech first because I like building things.",
    friendRequest: null,
    heardAboutScottylabs: "A friend on the Tech committee.",
    preferences: [
      { committeeId: COMMITTEE_TECH, name: "Tech", rank: 1 },
      { committeeId: COMMITTEE_DESIGN, name: "Design", rank: 2 },
    ],
    sections: [
      {
        section: "General",
        committeeId: null,
        committeeName: null,
        answers: [
          {
            key: "why",
            questionText: "Why do you want to join ScottyLabs?",
            answerText: "I want to ship things students actually use.",
            answerType: "long_text",
            displayOrder: 1,
          },
          {
            key: "portfolio",
            questionText: "Portfolio link",
            answerText: "https://example.com/robin",
            answerType: "url",
            displayOrder: 2,
          },
        ],
      },
      {
        section: "Committee response",
        committeeId: COMMITTEE_TECH,
        committeeName: "Tech",
        answers: [
          {
            key: "tech_project",
            questionText: "Describe a project you built.",
            answerText: "A scheduling tool for my club.",
            answerType: "long_text",
            displayOrder: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function application(overrides: Partial<Application> = {}): Application {
  return {
    applicationId: APPLICATION_ID,
    applicantName: "Robin Fixture",
    email: "robin@example.edu",
    year: "sophomore",
    major: "Information Systems",
    committees: [
      { committeeId: COMMITTEE_TECH, name: "Tech", rank: 1, hasCandidacy: true },
      { committeeId: COMMITTEE_DESIGN, name: "Design", rank: 2, hasCandidacy: false },
    ],
    detail: applicationDetail(),
    ...overrides,
  };
}

export function aggregate(overrides: Partial<Aggregate> = {}): Aggregate {
  return {
    candidacyId: CANDIDACY_ID,
    committeeId: COMMITTEE_TECH,
    applicationId: APPLICATION_ID,
    applicantName: "Robin Fixture",
    applicantRank: 1,
    assignedCount: 2,
    submittedCount: 2,
    minimumReviews: 2,
    completionPercent: 100,
    statistics: {
      count: 2,
      mean: 3.5,
      median: 3.5,
      min: 2,
      max: 5,
      spread: 3,
      standardDeviation: 1.5,
    },
    recommendationCounts: { strong_yes: 1, no: 1 },
    confidenceCounts: { high: 1, low: 1 },
    criterionAverages: [
      { criterionKey: "technical_depth", label: "Technical depth", average: 3.5 },
    ],
    disagreement: { flagged: false, reasons: [] },
    ...overrides,
  };
}

export function rankingRow(overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    rank: 1,
    tied: false,
    candidacyId: CANDIDACY_ID,
    applicationId: APPLICATION_ID,
    applicantName: "Robin Fixture",
    applicantRank: 1,
    submittedCount: 2,
    minimumReviews: 3,
    mean: 3.5,
    median: 3.5,
    spread: 3,
    recommendationCounts: { strong_yes: 1, no: 1 },
    flagged: false,
    reasons: [],
    ...overrides,
  };
}

export function peerReview(overrides: Partial<PeerReview> = {}): PeerReview {
  return {
    reviewId: "review-2",
    reviewerUserId: "bob",
    recommendation: "yes",
    confidence: "medium",
    rationale: "Solid project experience and clear writing.",
    computedScore: 4,
    submittedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * The caller's own standing. `committeeId` is typed `string` by the generated
 * client but is `null` on the wire for a cycle-wide membership, so the
 * cycle-wide fixtures below cast deliberately to reproduce what the server
 * actually sends.
 */
export function myStanding(overrides: Partial<MyStanding> = {}): MyStanding {
  return {
    userId: "alice",
    globalRole: "user",
    cycleId: CYCLE_ID,
    memberships: [{ role: "reviewer", committeeId: null as unknown as string }],
    unblindedCandidacyIds: [],
    blindReviewEnabled: false,
    ...overrides,
  };
}

export function leadStanding(committeeId = COMMITTEE_TECH): MyStanding {
  return myStanding({ memberships: [{ role: "committee_lead", committeeId }] });
}

export function adminStanding(): MyStanding {
  return myStanding({
    globalRole: "admin",
    memberships: [{ role: "recruitment_admin", committeeId: null as unknown as string }],
  });
}

export function cycleProgress(overrides: Partial<CycleProgress> = {}): CycleProgress {
  return {
    applicationCount: 1,
    candidacyCount: 1,
    placementCount: 0,
    ...overrides,
  };
}

/* Spreadsheet import. */

export type ImportPreview = components["schemas"]["ImportPreviewSummary"];
export type ImportCommitReport = components["schemas"]["ImportCommitReport"];
export type ImportSummary =
  paths["/recruitment/cycles/{cycleId}/imports"]["get"]["responses"][200]["content"]["application/json"][number];
export type ImportRowOutcome =
  paths["/recruitment/imports/{importId}/rows"]["get"]["responses"][200]["content"]["application/json"][number];

export const IMPORT_ID = "import-1";

export function importPreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    sheetName: "Form Responses 1",
    rowCount: 3,
    okCount: 2,
    errorCount: 1,
    mapping: {
      fields: [
        {
          header: "Email Address",
          key: "email",
          section: "general",
          role: "identity",
          answerType: "short_text",
          matchedBy: "exact",
        },
      ],
      unmappedHeaders: [],
      missingHeaders: [],
    },
    duplicateEmails: [],
    failures: [],
    ...overrides,
  };
}

/**
 * One rejected row as the preview reports it. The preview deliberately carries
 * no parsed applications, only the row number and the columns at fault.
 */
export function failedImportRow(
  sourceRowNumber: number,
  errors: Array<{ column: string; field: string; message: string; value: string | null }>,
): ImportPreview["failures"][number] {
  return { sourceRowNumber, errors };
}

export function importSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: IMPORT_ID,
    filename: "fall-2026-responses.xlsx",
    status: "committed",
    rowCount: 3,
    successCount: 2,
    errorCount: 1,
    createdAt: "2026-01-06T00:00:00.000Z",
    committedAt: "2026-01-06T00:05:00.000Z",
    ...overrides,
  };
}

export function importRowOutcome(overrides: Partial<ImportRowOutcome> = {}): ImportRowOutcome {
  return {
    sourceRowNumber: 2,
    status: "imported",
    applicationId: APPLICATION_ID,
    errorMessage: "",
    ...overrides,
  };
}

export function importCommitReport(
  overrides: Partial<ImportCommitReport> = {},
): ImportCommitReport {
  return {
    importId: IMPORT_ID,
    rowCount: 3,
    created: 2,
    updated: 0,
    skipped: 0,
    errors: 1,
    candidaciesCreated: 2,
    unknownCommitteeSlugs: [],
    ...overrides,
  };
}

/* Rubric versions. */

export type RubricVersion = components["schemas"]["RubricVersionSummary"];
export type RubricValidation =
  paths["/recruitment/cycles/{cycleId}/rubrics/validate"]["post"]["responses"][200]["content"]["application/json"];

export function rubricVersion(overrides: Partial<RubricVersion> = {}): RubricVersion {
  return {
    id: "rubric-v1",
    version: 1,
    name: "Cycle rubric",
    committeeId: null,
    active: true,
    reviewCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    criteria: [
      {
        id: "criterion-1",
        key: "technical_depth",
        label: "Technical depth",
        description: "How deeply did they engage with the technical prompt?",
        weight: 0.6,
        minScore: 1,
        maxScore: 5,
        source: "reviewer",
        displayOrder: 1,
        active: true,
      },
      {
        id: "criterion-2",
        key: "collaboration",
        label: "Collaboration",
        description: null,
        weight: 0.4,
        minScore: 1,
        maxScore: 5,
        source: "reviewer",
        displayOrder: 2,
        active: true,
      },
    ],
    ...overrides,
  };
}

/* Exports. */

export type RankingExport = components["schemas"]["RankingExportRow"];
export type DecisionExport = components["schemas"]["DecisionExportRow"];
export type ReviewerLoadExport = components["schemas"]["ReviewerLoadExportRow"];

export function rankingExportRow(overrides: Partial<RankingExport> = {}): RankingExport {
  return {
    rank: 1,
    tied: false,
    applicantName: "Robin Fixture",
    email: "robin@example.edu",
    year: "sophomore",
    major: "Information Systems",
    committee: "Tech",
    applicantRank: 1,
    submittedReviews: 2,
    minimumReviews: 2,
    mean: 3.5,
    median: 3.5,
    spread: 3,
    standardDeviation: 1.5,
    strongYes: 1,
    yes: 0,
    unsure: 0,
    no: 1,
    strongNo: 0,
    flagged: false,
    flagReasons: "",
    decision: "pending",
    ...overrides,
  };
}

export function decisionExportRow(overrides: Partial<DecisionExport> = {}): DecisionExport {
  return {
    applicantName: "Robin Fixture",
    email: "robin@example.edu",
    year: "sophomore",
    committee: "Tech",
    applicantRank: 1,
    committeeDecision: "accept",
    decisionNotes: "Strong, thoughtful application.",
    finalPlacement: "placed",
    placedCommittee: "Tech",
    ...overrides,
  };
}

export function reviewerLoadExportRow(
  overrides: Partial<ReviewerLoadExport> = {},
): ReviewerLoadExport {
  return {
    reviewerUserId: "alice",
    reviewerName: "Alice",
    role: "reviewer",
    committee: "Tech",
    assigned: 4,
    submitted: 3,
    conflicted: 0,
    outstanding: 1,
    ...overrides,
  };
}

/** The committee-decisions response the ranking screen reads. */
export interface CommitteeDecisions {
  capacity: number | null;
  acceptedCount: number;
  overCapacity: boolean;
  decisions: Array<{
    candidacyId: string;
    applicationId: string;
    applicantName: string | null;
    status: string | null;
    notes: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
  }>;
}

export function committeeDecision(
  overrides: Partial<CommitteeDecisions["decisions"][number]> = {},
): CommitteeDecisions["decisions"][number] {
  return {
    candidacyId: CANDIDACY_ID,
    applicationId: APPLICATION_ID,
    applicantName: "Robin Fixture",
    status: "pending",
    notes: null,
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}
