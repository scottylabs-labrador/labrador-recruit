import { http, HttpResponse } from "msw";

/**
 * The mocked API surface.
 *
 * Deliberately small. The handlers grow with the endpoints they stand in for,
 * and `onUnhandledRequest: "error"` means an endpoint a test forgets to mock
 * fails loudly here rather than hanging — so an empty-looking file is the
 * honest starting point rather than a gap.
 */
const API = "http://localhost:3001";

export type Session = {
  user: { id: string; name: string; email: string; role: "admin" | "user" | "guest" };
} | null;

export let session: Session = null;

export function setSession(next: Session) {
  session = next;
}

let identityProviderConfigured = true;

export function setIdentityProviderConfigured(next: boolean) {
  identityProviderConfigured = next;
}

export interface CurrentCycle {
  slug: string;
  name: string;
  description: string | null;
  timeZone: string;
  opensAt: string | null;
  closesAt: string | null;
  maxCommitteesPerApplicant: number | null;
  requirePreferenceRanking: boolean;
}

export interface PublicOpening {
  openingId: string;
  teamSlug: string;
  teamName: string;
  description: string | null;
  accepting: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * The default cycle every test starts from.
 *
 * A cycle that is open with a deadline in the future is the ordinary case, so
 * a test that cares about something else overrides only the field it is about
 * and the rest stays legible.
 */
export const DEFAULT_CYCLE: CurrentCycle = {
  slug: "spring-2027",
  name: "Spring 2027 Recruitment",
  description: "Apply to ScottyLabs committees.",
  timeZone: "America/New_York",
  opensAt: "2027-01-05T17:00:00.000Z",
  closesAt: "2027-02-01T04:59:00.000Z",
  maxCommitteesPerApplicant: 3,
  requirePreferenceRanking: false,
};

export const DEFAULT_OPENINGS: PublicOpening[] = [
  {
    openingId: "opening-labrador",
    teamSlug: "labrador",
    teamName: "Labrador",
    description: "Product teams building for the CMU community.",
    accepting: true,
    opensAt: "2027-01-05T17:00:00.000Z",
    closesAt: "2027-02-01T04:59:00.000Z",
  },
  {
    openingId: "opening-design",
    teamSlug: "design",
    teamName: "Design",
    description: "Brand, product and event design.",
    accepting: true,
    opensAt: "2027-01-05T17:00:00.000Z",
    closesAt: null,
  },
];

// `undefined` is a cycle that exists; `null` is none, which the endpoint
// answers with a 404. The two are different pages, so the fixture keeps them
// distinguishable rather than collapsing both to a falsy value.
let currentCycle: CurrentCycle | null = DEFAULT_CYCLE;
let openings: PublicOpening[] = DEFAULT_OPENINGS;

export function setCurrentCycle(next: CurrentCycle | null) {
  currentCycle = next;
}

export function setOpenings(next: PublicOpening[]) {
  openings = next;
}

export interface ProfileView {
  cycleSlug: string;
  cycleName: string;
  closesAt: string | null;
  commonLocked: boolean;
}

export type ApplicantStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Interview"
  | "Decision Available"
  | "Withdrawn";

export interface ApplicationSummary {
  applicationId: string;
  openingId: string;
  committeeName: string;
  committeeSlug: string;
  status: ApplicantStatus;
  lastSavedAt: string | null;
  submittedAt: string | null;
}

export const DEFAULT_PROFILE: ProfileView = {
  cycleSlug: "spring-2027",
  cycleName: "Spring 2027 Recruitment",
  closesAt: "2027-02-01T04:59:00.000Z",
  commonLocked: false,
};

// `null` is no profile at all, which the endpoint answers with a 404 - the
// ordinary state between seasons rather than an error.
let profile: ProfileView | null = DEFAULT_PROFILE;
let applications: ApplicationSummary[] = [];

export function setProfile(next: ProfileView | null) {
  profile = next;
}

export function setApplications(next: ApplicationSummary[]) {
  applications = next;
}

/**
 * Every withdraw the page actually sent.
 *
 * Recorded rather than asserted through a spy, because what matters is that
 * the request reached the API exactly once - a confirmation step that still
 * fires on the first click would pass a spy-free test and lose somebody's
 * application.
 */
export const withdrawCalls: string[] = [];

export function resetCatalogue() {
  withdrawCalls.length = 0;
  currentCycle = DEFAULT_CYCLE;
  openings = DEFAULT_OPENINGS;
  profile = DEFAULT_PROFILE;
  applications = [];
}

export const handlers = [
  http.get(`${API}/api/auth/get-session`, () => HttpResponse.json(session)),

  http.get(`${API}/v1/auth/config`, () =>
    HttpResponse.json({
      identityProviderConfigured,
      passwordSignInEnabled: !identityProviderConfigured,
    }),
  ),

  http.get(`${API}/v1/health`, () => HttpResponse.json({ status: "ok" })),

  http.get(`${API}/v1/cycles/current`, () =>
    currentCycle === null
      ? HttpResponse.json(
          { message: "There is no recruitment cycle at the moment." },
          { status: 404 },
        )
      : HttpResponse.json(currentCycle),
  ),

  http.get(`${API}/v1/openings`, () => HttpResponse.json(openings)),

  http.get(`${API}/v1/me/profile`, () =>
    profile === null
      ? HttpResponse.json({ message: "Not found" }, { status: 404 })
      : HttpResponse.json(profile),
  ),

  http.get(`${API}/v1/me/applications`, () => HttpResponse.json(applications)),

  http.post(`${API}/v1/me/applications/:applicationId/withdraw`, ({ params }) => {
    const id = String(params["applicationId"]);
    withdrawCalls.push(id);
    applications = applications.map((row) =>
      row.applicationId === id ? { ...row, status: "Withdrawn" as const } : row,
    );
    const row = applications.find((candidate) => candidate.applicationId === id);
    return row === undefined
      ? HttpResponse.json({ message: "Not found" }, { status: 404 })
      : HttpResponse.json(row);
  }),
];
