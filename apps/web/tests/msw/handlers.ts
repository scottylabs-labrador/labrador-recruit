import type { components } from "@recruit/server/build/swagger";
import { http, HttpResponse } from "msw";

/**
 * Every fixture in this file is typed against the generated API schema.
 *
 * Three of them were originally hand-written and all three were wrong: the
 * question definitions invented `id`, `helpText` and `visibleWhen` so the form
 * rendered nothing; the 409 body nested `details.revision` where the server
 * spreads it at the top level; and the submission result invented
 * `{ submittedAt, applicationIds, commonLocked }` where the server returns
 * `{ submitted: [...] }` - and that last one had a *passing* test against a
 * response the server has never sent.
 *
 * A fixture that does not match the contract tests a product that does not
 * exist. Aliasing them to `components["schemas"][...]` makes the next drift a
 * compile error instead of a green test.
 */
type Schemas = components["schemas"];

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

export type CurrentCycle = Schemas["CurrentCycle"];

export type PublicOpening = Schemas["PublicOpening"];

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

export type ProfileView = Schemas["ProfileView"];

export type ApplicantStatus = ApplicationSummary["status"];

export type ApplicationSummary = Schemas["ApplicationSummary"];

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

/** Every opening the page asked to apply to, in order. */
export const applyCalls: string[] = [];

/**
 * The last ordering the page sent, and every ordering it sent.
 *
 * The whole list each time, because a ranking is one statement about a set -
 * a page that sent them one at a time would pass a "did it call the endpoint"
 * assertion while recording two first choices.
 */
export const preferenceCalls: string[][] = [];

/** Every upload the page asked for, and every object it PUT. */
export const uploadCalls: { originalFilename: string; mimeType: string; sizeBytes: number }[] = [];
export const putCalls: string[] = [];
export const commitCalls: string[] = [];

/**
 * How the next commit is answered.
 *
 * `"ok"` commits. `"wrong-type"` is the 422 the server returns when the bytes
 * are not the format they claim - the case that matters, because the declared
 * type came from the browser.
 */
let nextCommit: "ok" | "wrong-type" = "ok";

export function setNextCommit(next: "ok" | "wrong-type") {
  nextCommit = next;
}

const committedFiles = new Map<string, { originalFilename: string; mimeType: string }>();

export function setCommittedFile(
  fileId: string,
  info: { originalFilename: string; mimeType: string },
) {
  committedFiles.set(fileId, info);
}

/** Every submission the page sent: the key and what it named. */
export const submissionCalls: Schemas["SubmitBody"][] = [];

/**
 * How the next submission is answered.
 *
 * `"ok"` commits. `"incomplete"` is the 422 the server returns when a required
 * answer is missing, carrying the per-application detail the review page has
 * to render. `"deadline"` is the 409 for a passed deadline.
 */
let nextSubmission: "ok" | "incomplete" | "deadline" = "ok";

export function setNextSubmission(next: "ok" | "incomplete" | "deadline") {
  nextSubmission = next;
}

export type QuestionDefinitionFixture = Schemas["QuestionDefinition"];

export type PublishedFormFixture = Schemas["PublishedForm"];

export const COMMON_FORM: PublishedFormFixture = {
  formId: "form-common",
  kind: "common",
  title: "Shared questions",
  description: "Answered once and reused for every committee.",
  version: 1,
  questions: [
    {
      questionKey: "major",
      type: "short_text",
      label: "Your major",
      required: true,
      position: 1,
      config: null,
      visibilityRule: null,
    },
    {
      questionKey: "year",
      type: "single_select",
      label: "Year",
      required: true,
      position: 2,
      config: { choices: ["First year", "Sophomore", "Junior", "Senior"] },
      visibilityRule: null,
    },
    {
      questionKey: "transferFrom",
      type: "short_text",
      label: "Which school did you transfer from?",
      required: false,
      position: 3,
      config: null,
      visibilityRule: { equals: { questionKey: "year", value: "Junior" } },
    },
  ],
};

export const COMMITTEE_FORM: PublishedFormFixture = {
  formId: "form-labrador",
  kind: "committee",
  title: "Labrador application",
  description: null,
  version: 1,
  questions: [
    {
      questionKey: "why",
      type: "long_text",
      label: "Why Labrador?",
      required: true,
      position: 1,
      config: null,
      visibilityRule: null,
    },
  ],
};

let forms: PublishedFormFixture[] = [COMMON_FORM, COMMITTEE_FORM];

export function setForms(next: PublishedFormFixture[]) {
  forms = next;
}

export type CommonResponseFixture = Schemas["CommonResponseView"];

export const DEFAULT_COMMON_RESPONSE: CommonResponseFixture = {
  formId: "form-common",
  title: "Shared questions",
  description: "Answered once and reused for every committee.",
  revision: 0,
  answers: {},
  locked: false,
};

let commonResponse: CommonResponseFixture = DEFAULT_COMMON_RESPONSE;

export function setCommonResponse(next: CommonResponseFixture) {
  commonResponse = { ...next };
}

/** Answers and revisions per application, for the committee draft routes. */
const applicationDrafts = new Map<string, ApplicationDraft>();

interface ApplicationDraft {
  formId: string | null;
  revision: number;
  answers: Schemas["AnswerMap"];
}

export function setApplicationDraft(applicationId: string, draft: ApplicationDraft) {
  applicationDrafts.set(applicationId, { ...draft });
}

/**
 * Forces the next draft save to be refused as stale.
 *
 * A laptop and a phone both autosaving is the ordinary case rather than an
 * edge case, so the page's behaviour on a 409 is a first-class thing to test:
 * it must say the other tab is ahead and must not discard what was typed.
 */
let nextSaveConflicts = false;

export function failNextDraftSaveWithConflict() {
  nextSaveConflicts = true;
}

/** Every draft save the page sent, in order, with what it carried. */
export const draftSaves: {
  target: string;
  revision: number;
  answers: Schemas["DraftBody"]["answers"];
}[] = [];

export function resetCatalogue() {
  withdrawCalls.length = 0;
  applyCalls.length = 0;
  preferenceCalls.length = 0;
  draftSaves.length = 0;
  submissionCalls.length = 0;
  nextSubmission = "ok";
  uploadCalls.length = 0;
  putCalls.length = 0;
  commitCalls.length = 0;
  nextCommit = "ok";
  committedFiles.clear();
  forms = [COMMON_FORM, COMMITTEE_FORM];
  commonResponse = { ...DEFAULT_COMMON_RESPONSE, answers: {} };
  applicationDrafts.clear();
  nextSaveConflicts = false;
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

  http.get(`${API}/v1/forms/:formId/published`, ({ params }) => {
    const row = forms.find((candidate) => candidate.formId === String(params["formId"]));
    return row === undefined
      ? HttpResponse.json({ message: "Not found" }, { status: 404 })
      : HttpResponse.json(row);
  }),

  http.get(`${API}/v1/me/common-response`, () => HttpResponse.json(commonResponse)),

  http.patch(`${API}/v1/me/common-response/draft`, async ({ request }) => {
    const body = (await request.json()) as Schemas["DraftBody"];
    draftSaves.push({ target: "common", revision: body.revision, answers: body.answers });

    if (nextSaveConflicts) {
      nextSaveConflicts = false;
      return HttpResponse.json(
        {
          name: "ConflictError",
          message: "Your answers changed somewhere else. Reload to see the newer version.",
          // `currentRevision`, which is what `saveAnswers` puts in
          // `ConflictError`'s details. The fourth fixture in this file caught
          // inventing a field name - harmless today only because the page
          // shows the server's message and does not read this one.
          currentRevision: 9,
        },
        { status: 409 },
      );
    }
    for (const answer of body.answers) {
      commonResponse.answers[answer.questionKey] = answer.value;
    }
    commonResponse.revision += 1;
    return HttpResponse.json({
      revision: commonResponse.revision,
      savedAt: "2027-01-20T15:04:00.000Z",
    });
  }),

  http.get(`${API}/v1/me/applications/:applicationId`, ({ params }) => {
    const id = String(params["applicationId"]);
    const summary = applications.find((row) => row.applicationId === id);
    const draft = applicationDrafts.get(id);
    if (summary === undefined) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }
    return HttpResponse.json({
      ...summary,
      formId: draft?.formId ?? COMMITTEE_FORM.formId,
      revision: draft?.revision ?? 0,
      answers: draft?.answers ?? {},
    });
  }),

  http.patch(`${API}/v1/me/applications/:applicationId/draft`, async ({ params, request }) => {
    const id = String(params["applicationId"]);
    const body = (await request.json()) as Schemas["DraftBody"];
    draftSaves.push({ target: id, revision: body.revision, answers: body.answers });

    if (nextSaveConflicts) {
      nextSaveConflicts = false;
      return HttpResponse.json(
        {
          name: "ConflictError",
          message: "Your answers changed somewhere else. Reload to see the newer version.",
          currentRevision: 9,
        },
        { status: 409 },
      );
    }
    const current = applicationDrafts.get(id) ?? {
      formId: COMMITTEE_FORM.formId,
      revision: 0,
      answers: {},
    };
    for (const answer of body.answers) {
      current.answers[answer.questionKey] = answer.value;
    }
    current.revision += 1;
    applicationDrafts.set(id, current);
    return HttpResponse.json({
      revision: current.revision,
      savedAt: "2027-01-20T15:04:00.000Z",
    });
  }),

  http.post(`${API}/v1/files`, async ({ request }) => {
    const body = (await request.json()) as {
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
    };
    uploadCalls.push(body);
    const fileId = `file-${uploadCalls.length}`;
    committedFiles.set(fileId, {
      originalFilename: body.originalFilename,
      mimeType: body.mimeType,
    });
    return HttpResponse.json(
      {
        fileId,
        uploadUrl: `${API}/__local-storage/put?key=uploads/${fileId}&exp=1&sig=x`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      },
      { status: 201 },
    );
  }),

  http.put(`${API}/__local-storage/put`, ({ request }) => {
    putCalls.push(new URL(request.url).searchParams.get("key") ?? "");
    return HttpResponse.json({ status: "ok" });
  }),

  http.post(`${API}/v1/files/:fileId/commit`, ({ params }) => {
    const fileId = String(params["fileId"]);
    commitCalls.push(fileId);

    if (nextCommit === "wrong-type") {
      return HttpResponse.json(
        {
          name: "ValidationFailed",
          message:
            "That file does not match the type it claims to be. Please upload a PDF, PNG or JPEG.",
        },
        { status: 422 },
      );
    }
    const info = committedFiles.get(fileId);
    return HttpResponse.json({
      fileId,
      originalFilename: info?.originalFilename ?? "upload",
      mimeType: info?.mimeType ?? "application/pdf",
      sizeBytes: 1024,
    });
  }),

  http.get(`${API}/v1/files/:fileId/download`, ({ params }) => {
    const fileId = String(params["fileId"]);
    const info = committedFiles.get(fileId);
    return info === undefined
      ? HttpResponse.json({ message: "Not found" }, { status: 404 })
      : HttpResponse.json({
          url: `${API}/__local-storage/get?key=uploads/${fileId}&exp=1&sig=x`,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          originalFilename: info.originalFilename,
        });
  }),

  http.post(`${API}/v1/me/submissions`, async ({ request }) => {
    const body = (await request.json()) as Schemas["SubmitBody"];
    submissionCalls.push(body);

    if (nextSubmission === "incomplete") {
      return HttpResponse.json(
        {
          name: "ValidationFailedError",
          message: "Some answers are missing.",
          problems: [
            {
              applicationId: "app-labrador",
              committeeName: "Labrador",
              missing: ["why"],
              invalid: [],
            },
          ],
        },
        { status: 422 },
      );
    }
    if (nextSubmission === "deadline") {
      return HttpResponse.json(
        {
          name: "ConflictError",
          message: "The deadline for this recruitment cycle has passed.",
        },
        { status: 409 },
      );
    }

    applications = applications.map((row) =>
      body.applicationIds.includes(row.applicationId)
        ? { ...row, status: "Submitted" as const, submittedAt: "2027-01-22T18:00:00.000Z" }
        : row,
    );
    commonResponse.locked = true;
    return HttpResponse.json({
      submitted: body.applicationIds.map((applicationId) => ({
        applicationId,
        committeeName:
          applications.find((row) => row.applicationId === applicationId)?.committeeName ??
          "Committee",
        submittedAt: "2027-01-22T18:00:00.000Z",
      })),
    });
  }),

  http.patch(`${API}/v1/me/applications/preferences`, async ({ request }) => {
    const body = (await request.json()) as Schemas["PreferencesBody"];
    preferenceCalls.push(body.applicationIds);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post(`${API}/v1/me/applications`, async ({ request }) => {
    const body = (await request.json()) as { openingId: string };
    applyCalls.push(body.openingId);
    const opening = openings.find((row) => row.openingId === body.openingId);
    if (opening === undefined) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }
    const existing = applications.find((row) => row.openingId === body.openingId);
    if (existing !== undefined) {
      return HttpResponse.json(existing);
    }
    const created: ApplicationSummary = {
      applicationId: `app-${opening.teamSlug}`,
      openingId: opening.openingId,
      committeeName: opening.teamName,
      committeeSlug: opening.teamSlug,
      status: "Draft",
      lastSavedAt: null,
      submittedAt: null,
    };
    applications = [...applications, created];
    return HttpResponse.json(created, { status: 201 });
  }),

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
