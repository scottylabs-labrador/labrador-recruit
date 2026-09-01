import { http, HttpResponse } from "msw";

import { API_URL } from "../fixtures.ts";
import type {
  Aggregate,
  Application,
  Committee,
  Cycle,
  PeerReview,
  QueueEntry,
  RankingEntry,
  Review,
  Rubric,
} from "../recruitmentFixtures.ts";

export let session: ReturnType<typeof import("../fixtures.ts").userSession> | null = null;
export let adminUsers: Array<{
  id: string;
  name: string;
}> = [];

export function setSession(next: typeof session) {
  session = next;
}

export function setAdminUsers(next: typeof adminUsers) {
  adminUsers = next;
}

/* Recruitment state. Mutable module-level values with setters, matching the
   pattern the existing dashboard handlers established. */

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

export const handlers = [
  http.get(`${API_URL}/api/auth/*`, () => {
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

  http.get(`${RECRUITMENT}/cycles/:cycleId/committees`, async ({ request }) => {
    await record("GET", request);
    return HttpResponse.json(committees);
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
];
