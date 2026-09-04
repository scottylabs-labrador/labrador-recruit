import { http, HttpResponse } from "msw";

import { API_URL } from "../fixtures.ts";
import type {
  Aggregate,
  Application,
  Committee,
  Cycle,
  CycleProgress,
  DecisionExport,
  ImportCommitReport,
  ImportPreview,
  ImportRowOutcome,
  ImportSummary,
  MyStanding,
  PeerReview,
  QueueEntry,
  RankingEntry,
  RankingExport,
  Review,
  ReviewerLoadExport,
  Rubric,
  RubricValidation,
  RubricVersion,
} from "../recruitmentFixtures.ts";

export let session: ReturnType<typeof import("../fixtures.ts").userSession> | null = null;
export let adminUsers: Array<{
  id: string;
  name: string;
}> = [];

export function setSession(next: typeof session) {
  session = next;
}

/**
 * Whether the deployment has a registered OIDC client. Defaults to true, which
 * is what a properly configured deployment reports.
 */
export let identityProviderConfigured = true;

export function setIdentityProviderConfigured(next: boolean) {
  identityProviderConfigured = next;
}

export function setAdminUsers(next: typeof adminUsers) {
  adminUsers = next;
}

/**
 * Recruitment state. Mutable module-level values with setters, matching the
 * pattern the existing dashboard handlers established.
 */

export let cycles: Cycle[] = [];
export let committees: Committee[] = [];
export let queue: QueueEntry[] = [];
export let applications: Application[] = [];
export let rubric: Rubric | null = null;
export let review: Review | null = null;
export let aggregates: Aggregate[] = [];
export let ranking: RankingEntry[] = [];
export let disagreements: Aggregate[] = [];
export let peerReviews: PeerReview[] = [];
/** Null means `/me` 404s, which is how "no standing in this cycle" arrives. */
export let standing: MyStanding | null = null;
export let progress: CycleProgress | null = null;
export let workloads: Array<{
  userId: string;
  assigned: number;
  submitted: number;
  conflicted: number;
  outstanding: number;
}> = [];

/** Every recruitment request the handlers served, so tests can assert on calls. */
export let recordedRequests: Array<{ method: string; url: string; body: unknown }> = [];

export function setCycles(next: Cycle[]) {
  cycles = next;
}
export function setCommittees(next: Committee[]) {
  committees = next;
}
export function setQueue(next: QueueEntry[]) {
  queue = next;
}
export function setApplications(next: Application[]) {
  applications = next;
}
export function setRubric(next: Rubric | null) {
  rubric = next;
}
export function setReview(next: Review | null) {
  review = next;
}
export function setAggregates(next: Aggregate[]) {
  aggregates = next;
}
export function setRanking(next: RankingEntry[]) {
  ranking = next;
}
export function setDisagreements(next: Aggregate[]) {
  disagreements = next;
}
export function setPeerReviews(next: PeerReview[]) {
  peerReviews = next;
}
export function setWorkloads(next: typeof workloads) {
  workloads = next;
}
export function setStanding(next: MyStanding | null) {
  standing = next;
}
export function setProgress(next: CycleProgress | null) {
  progress = next;
}

/**
 * Import, rubric-version, and export state. Same mutable-value-plus-setter
 * pattern as everything above, and every one of these is reset in `setup.ts`.
 */

export let imports: ImportSummary[] = [];
export let importPreview: ImportPreview | null = null;
export let importRows: ImportRowOutcome[] = [];
export let commitReport: ImportCommitReport | null = null;
export let rubricVersions: RubricVersion[] = [];
export let rubricValidation: RubricValidation | null = null;
export let rankingExport: RankingExport[] = [];
export let decisionExport: DecisionExport[] = [];
export let reviewerLoadExport: ReviewerLoadExport[] = [];

export function setImports(next: ImportSummary[]) {
  imports = next;
}
export function setImportPreview(next: ImportPreview | null) {
  importPreview = next;
}
export function setImportRows(next: ImportRowOutcome[]) {
  importRows = next;
}
export function setCommitReport(next: ImportCommitReport | null) {
  commitReport = next;
}
export function setRubricVersions(next: RubricVersion[]) {
  rubricVersions = next;
}
export function setRubricValidation(next: RubricValidation | null) {
  rubricValidation = next;
}
export function setRankingExport(next: RankingExport[]) {
  rankingExport = next;
}
export function setDecisionExport(next: DecisionExport[]) {
  decisionExport = next;
}
export function setReviewerLoadExport(next: ReviewerLoadExport[]) {
  reviewerLoadExport = next;
}
export function resetRecordedRequests() {
  recordedRequests = [];
}

export function requestsMatching(method: string, fragment: string) {
  return recordedRequests.filter(
    (entry) => entry.method === method && entry.url.includes(fragment),
  );
}

async function record(method: string, request: Request) {
  let body: unknown = null;
  if (method !== "GET") {
    body = await request
      .clone()
      .json()
      .catch(() => null);
  }
  recordedRequests.push({ method, url: request.url, body });
}

const RECRUITMENT = `${API_URL}/recruitment`;

type SaveBody = Partial<Omit<Review, "scores">> & { scores?: Record<string, number> };

/**
 * Mirrors the server: the save request carries `scores` as a criterion-keyed
 * map, while the stored review returns them as an array.
 */
function applySave(current: Review, body: SaveBody): Review {
  const { scores, ...rest } = body;
  return {
    ...current,
    ...rest,
    scores:
      scores === undefined
        ? current.scores
        : Object.entries(scores).map(([criterionKey, score]) => ({ criterionKey, score })),
  };
}

/**
 * Simulates the identity provider being unreachable, which is what a
 * misconfigured issuer or a Keycloak outage looks like from the browser.
 */
export let signInFails = false;
export function setSignInFails(next: boolean) {
  signInFails = next;
}

/** What the last password sign-in was posted, so a test can assert on it. */
export let lastSignIn: { email: string; password: string } | null = null;
export let lastPasswordChange: { currentPassword: string; newPassword: string } | null = null;
export let rejectCredentials = false;

export function setRejectCredentials(next: boolean) {
  rejectCredentials = next;
}

export function resetAuthProbes() {
  lastSignIn = null;
  lastPasswordChange = null;
  rejectCredentials = false;
}

/** The last committee decision recorded, so a test can assert on it. */
export let lastDecision: { candidacyId: string; status: string } | null = null;

/** Every decision written, so a bulk action can be checked row by row. */
export let decisionLog: Array<{ candidacyId: string; status: string }> = [];

/** Candidacy ids the API should refuse, for testing a partial bulk failure. */
let rejectedCandidacyIds = new Set<string>();

export function setRejectedCandidacies(ids: readonly string[]) {
  rejectedCandidacyIds = new Set(ids);
}

export function resetDecisions() {
  lastDecision = null;
  decisionLog = [];
  rejectedCandidacyIds = new Set();
}

/** What the settings screen last sent, so a test can assert on the payload. */
export let lastCycleCreate: Record<string, unknown> | null = null;
export let lastCycleUpdate: Record<string, unknown> | null = null;
export let lastMembershipGrant: Record<string, unknown> | null = null;
export let lastRevokedMembershipId: string | null = null;
export let lastCommitteeAttach: Record<string, unknown> | null = null;
export let lastAccountCreate: Record<string, unknown> | null = null;
export let syncCallCount = 0;

/** The cached GitHub profile the API reports, and how often it was refreshed. */
let githubProfile: Record<string, unknown> | null = null;
export let githubRefreshCount = 0;

export function setGithubProfile(next: typeof githubProfile) {
  githubProfile = next;
}

let memberships: Array<Record<string, unknown>> = [];

export function setMemberships(next: typeof memberships) {
  memberships = next;
}

export function resetAdminRecorders() {
  lastCycleCreate = null;
  lastCycleUpdate = null;
  lastMembershipGrant = null;
  lastRevokedMembershipId = null;
  lastCommitteeAttach = null;
  lastAccountCreate = null;
  syncCallCount = 0;
  githubProfile = null;
  githubRefreshCount = 0;
  memberships = [];
}

export const handlers = [
  http.get(`${API_URL}/auth/config`, () => {
    // Mirrors the server: password sign-in is the fallback for a deployment
    // with no identity provider, never a second door alongside one. Deriving
    // it here rather than exposing a second switch keeps the fixture from
    // describing a combination the API cannot produce.
    return HttpResponse.json({
      identityProviderConfigured,
      passwordSignInEnabled: !identityProviderConfigured,
    });
  }),

  http.get(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/sign-in/email`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    lastSignIn = body;
    if (rejectCredentials) {
      return HttpResponse.json({ message: "Invalid email or password" }, { status: 401 });
    }
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/change-password`, async ({ request }) => {
    lastPasswordChange = (await request.json()) as { currentPassword: string; newPassword: string };
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/sign-in/*`, () => {
    if (signInFails) {
      return HttpResponse.json({ message: "provider unreachable" }, { status: 500 });
    }
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.get(`${API_URL}/admin/users`, () => {
    return HttpResponse.json(adminUsers);
  }),

  http.get(`${RECRUITMENT}/cycles`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(cycles);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId`, async ({ request, params }) => {
    await record("GET", request);
    const match = cycles.find((cycle) => cycle.id === params["cycleId"]);
    return match === undefined ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(match);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/me`, async ({ request }) => {
    await record("GET", request);
    return standing === null
      ? new HttpResponse(null, { status: 404 })
      : HttpResponse.json(standing);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/progress`, async ({ request }) => {
    await record("GET", request);
    return progress === null
      ? new HttpResponse(null, { status: 404 })
      : HttpResponse.json(progress);
  }),

  http.put(`${RECRUITMENT}/candidacies/:candidacyId/decision`, async ({ request, params }) => {
    await record("PUT", request);
    const body = (await request.json()) as { status: string };
    const candidacyId = String(params["candidacyId"]);
    if (rejectedCandidacyIds.has(candidacyId)) {
      // Deliberately bodyless. openapi-react-query throws only when the error
      // body parses, so this is the refusal that a naive bulk loop counts as a
      // success - which is the case worth having a test for.
      return new HttpResponse(null, { status: 409 });
    }
    lastDecision = { candidacyId, status: body.status };
    decisionLog.push(lastDecision);
    return HttpResponse.json({ candidacyId, status: body.status });
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/committees`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(committees);
  }),

  http.post(`${RECRUITMENT}/cycles`, async ({ request }) => {
    await record("POST", request);
    lastCycleCreate = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: "cycle-created", ...lastCycleCreate }, { status: 201 });
  }),

  http.patch(`${RECRUITMENT}/cycles/:cycleId`, async ({ request, params }) => {
    await record("PATCH", request);
    lastCycleUpdate = (await request.json()) as Record<string, unknown>;
    const match = cycles.find((cycle) => cycle.id === params["cycleId"]);
    return HttpResponse.json({ ...match, ...lastCycleUpdate });
  }),

  http.post(`${RECRUITMENT}/cycles/:cycleId/committees`, async ({ request }) => {
    await record("POST", request);
    lastCommitteeAttach = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: "committee-new", ...lastCommitteeAttach }, { status: 201 });
  }),

  http.post(`${RECRUITMENT}/cycles/:cycleId/sync`, async ({ request }) => {
    await record("POST", request);
    syncCallCount += 1;
    return HttpResponse.json(
      {
        importId: "import-from-sheet",
        preview: {
          sheetName: "Form Responses 1",
          mapping: {},
          rowCount: 12,
          okCount: 11,
          errorCount: 1,
          failures: [],
          duplicateEmails: [],
        },
      },
      { status: 201 },
    );
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/memberships`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(memberships);
  }),

  http.post(`${RECRUITMENT}/cycles/:cycleId/memberships`, async ({ request }) => {
    await record("POST", request);
    lastMembershipGrant = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: "membership-new", ...lastMembershipGrant }, { status: 201 });
  }),

  http.delete(`${RECRUITMENT}/memberships/:membershipId`, async ({ request, params }) => {
    await record("DELETE", request);
    lastRevokedMembershipId = String(params["membershipId"]);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_URL}/admin/users`, async ({ request }) => {
    await record("POST", request);
    lastAccountCreate = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        andrewId: String(lastAccountCreate["andrewId"]),
        email: `${String(lastAccountCreate["andrewId"])}@andrew.cmu.edu`,
        name: String(lastAccountCreate["name"]),
        role: typeof lastAccountCreate["role"] === "string" ? lastAccountCreate["role"] : "user",
        temporaryPassword: "fixture-temporary-password",
      },
      { status: 201 },
    );
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/my-queue`, async ({ request }) => {
    await record("GET", request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const committeeId = url.searchParams.get("committeeId");
    const filtered = queue.filter(
      (item) =>
        (status === null || item.status === status) &&
        (committeeId === null || item.committeeId === committeeId),
    );
    return HttpResponse.json(filtered);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/applications`, async ({ request }) => {
    await record("GET", request);
    const url = new URL(request.url);
    const committeeId = url.searchParams.get("committeeId");
    const filtered =
      committeeId === null
        ? applications
        : applications.filter((item) =>
            item.committees.some((committee) => committee.committeeId === committeeId),
          );
    return HttpResponse.json(filtered);
  }),

  http.get(`${RECRUITMENT}/applications/:applicationId/github`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json({ profile: githubProfile });
  }),

  http.post(`${RECRUITMENT}/applications/:applicationId/github/refresh`, async ({ request }) => {
    await record("POST", request);
    githubRefreshCount += 1;
    return HttpResponse.json({ profile: githubProfile });
  }),

  http.get(`${RECRUITMENT}/applications/:applicationId`, async ({ request, params }) => {
    await record("GET", request);
    const match = applications.find((item) => item.applicationId === params["applicationId"]);
    return match === undefined || match.detail === undefined
      ? new HttpResponse(null, { status: 404 })
      : HttpResponse.json(match.detail);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/committees/:committeeId/rubric`, async ({ request }) => {
    await record("GET", request);
    return rubric === null ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(rubric);
  }),

  http.get(
    `${RECRUITMENT}/cycles/:cycleId/committees/:committeeId/aggregates`,
    async ({ request }) => {
      await record("GET", request);
      return HttpResponse.json(aggregates);
    },
  ),

  http.get(
    `${RECRUITMENT}/cycles/:cycleId/committees/:committeeId/ranking`,
    async ({ request }) => {
      await record("GET", request);
      return HttpResponse.json(ranking);
    },
  ),

  http.get(
    `${RECRUITMENT}/cycles/:cycleId/committees/:committeeId/disagreements`,
    async ({ request }) => {
      await record("GET", request);
      return HttpResponse.json(disagreements);
    },
  ),

  http.get(`${RECRUITMENT}/cycles/:cycleId/workloads`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(workloads);
  }),

  http.get(`${RECRUITMENT}/assignments/:assignmentId/review`, async ({ request }) => {
    await record("GET", request);
    return review === null ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(review);
  }),

  http.put(`${RECRUITMENT}/assignments/:assignmentId/review`, async ({ request }) => {
    await record("PUT", request);
    const body = (await request.json()) as SaveBody;
    if (review !== null) {
      review = applySave(review, body);
    }
    return HttpResponse.json(review);
  }),

  http.post(`${RECRUITMENT}/assignments/:assignmentId/review/submit`, async ({ request }) => {
    await record("POST", request);
    const body = (await request.json()) as SaveBody;
    if (review !== null) {
      review = {
        ...applySave(review, body),
        submittedAt: "2026-02-01T00:00:00.000Z",
        computedScore: 4,
      };
    }
    queue = queue.map((item) =>
      item.assignmentId === review?.assignmentId
        ? { ...item, status: "submitted", submitted: true }
        : item,
    );
    return HttpResponse.json(review);
  }),

  http.post(`${RECRUITMENT}/assignments/:assignmentId/review/reopen`, async ({ request }) => {
    await record("POST", request);
    if (review !== null) {
      review = { ...review, submittedAt: null };
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${RECRUITMENT}/assignments/:assignmentId/conflict`, async ({ request, params }) => {
    await record("POST", request);
    queue = queue.map((item) =>
      item.assignmentId === params["assignmentId"] ? { ...item, status: "conflicted" } : item,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${RECRUITMENT}/candidacies/:candidacyId/reviews`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(peerReviews);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/imports`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(imports);
  }),

  http.post(`${RECRUITMENT}/cycles/:cycleId/imports`, async ({ request }) => {
    await record("POST", request);
    return importPreview === null
      ? new HttpResponse(null, { status: 422 })
      : HttpResponse.json({ importId: "import-1", preview: importPreview }, { status: 201 });
  }),

  http.get(`${RECRUITMENT}/imports/:importId/rows`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(importRows);
  }),

  http.post(`${RECRUITMENT}/imports/:importId/commit`, async ({ request }) => {
    await record("POST", request);
    return commitReport === null
      ? new HttpResponse(null, { status: 409 })
      : HttpResponse.json(commitReport);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/rubrics`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(rubricVersions);
  }),

  /**
   * Mirrors the server's weight rule rather than echoing a canned answer, so a
   * test that types an invalid draft gets the same verdict the server gives.
   * `setRubricValidation` overrides it when a test needs a specific issue.
   */
  http.post(`${RECRUITMENT}/cycles/:cycleId/rubrics/validate`, async ({ request }) => {
    await record("POST", request);
    if (rubricValidation !== null) {
      return HttpResponse.json(rubricValidation);
    }

    const body = (await request.json()) as {
      criteria: Array<{ weight: number; active?: boolean }>;
    };
    const active = body.criteria.filter((criterion) => criterion.active !== false);
    const sum = active.reduce((total, criterion) => total + criterion.weight, 0);

    if (active.length > 0 && Math.abs(sum - 1) <= 1e-6) {
      return HttpResponse.json({ valid: true, issues: [] });
    }
    return HttpResponse.json({
      valid: false,
      issues: [
        {
          code: "weights_do_not_sum_to_one",
          message: `The active criteria weights sum to ${sum} rather than 1. Adjust the weights so they add up to exactly 1.`,
        },
      ],
    });
  }),

  http.post(`${RECRUITMENT}/cycles/:cycleId/rubrics`, async ({ request }) => {
    await record("POST", request);
    const body = (await request.json()) as { name: string };
    const highest = rubricVersions.reduce((max, item) => Math.max(max, item.version), 0);
    const published: RubricVersion = {
      id: `rubric-v${highest + 1}`,
      version: highest + 1,
      name: body.name,
      committeeId: null,
      active: true,
      reviewCount: 0,
      createdAt: "2026-03-01T00:00:00.000Z",
      criteria: [],
    };
    rubricVersions = [published, ...rubricVersions.map((item) => ({ ...item, active: false }))];
    return HttpResponse.json(published, { status: 201 });
  }),

  http.get(
    `${RECRUITMENT}/cycles/:cycleId/exports/committees/:committeeId/ranking`,
    async ({ request }) => {
      await record("GET", request);
      return HttpResponse.json(rankingExport);
    },
  ),

  http.get(`${RECRUITMENT}/cycles/:cycleId/exports/decisions`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(decisionExport);
  }),

  http.get(`${RECRUITMENT}/cycles/:cycleId/exports/reviewer-load`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(reviewerLoadExport);
  }),
];
