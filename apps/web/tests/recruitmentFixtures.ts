import type { components } from "@labrador/server/build/swagger";

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

export interface Rubric {
  id: string;
  name: string;
  version: number;
  criteria: RubricCriterion[];
}

export interface PeerReview {
  reviewId: string;
  reviewerUserId: string;
  recommendation: "strong_yes" | "yes" | "unsure" | "no" | "strong_no";
  confidence: "high" | "medium" | "low";
  rationale: string;
  computedScore: string;
  submittedAt: string;
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
        weight: 1,
        minScore: 1,
        maxScore: 5,
        source: "committee",
        displayOrder: 1,
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
    mean: 3.5,
    median: 3.5,
    spread: 3,
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
    computedScore: "4.00",
    submittedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}
