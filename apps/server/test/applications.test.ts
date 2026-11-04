/**
 * The applicant's own application routes.
 *
 * Every route here is scoped to the caller's own `candidate_profile`. There is
 * no applicant route that takes another person's id — not a filtered one, not
 * an anonymized one — so the tests that matter most are the ones proving a
 * caller cannot reach somebody else's work.
 */
import {
  application,
  applicationStatusEvent,
  candidateProfile,
  form,
  formResponse,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
  team,
  user,
} from "@recruit/db/schema";
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { seedApplicant } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const now = new Date();
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
/**
 * A deadline that has passed but is still after `past`.
 *
 * `recruitment_cycle_window_ck` requires `closes_at > opens_at`, so a test
 * cannot simply reuse `past` for both — the constraint refuses it, correctly.
 */
const passedDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);

let cycleId: string;
let labradorOpening: string;
let designOpening: string;
let commonFormId: string;

/** Publishes a committee form for an opening, which is what a draft writes into. */
async function publishCommitteeForm(openingId: string, teamId: string) {
  const [committeeForm] = await testDb
    .insert(form)
    .values({
      cycleId,
      teamId,
      openingId,
      kind: "committee",
      title: "Committee Application",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: form.id });
  const [version] = await testDb
    .insert(formVersion)
    .values({
      formId: committeeForm!.id,
      version: 1,
      status: "published",
      publishedAt: now,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: formVersion.id });
  await testDb.insert(question).values([
    {
      formVersionId: version!.id,
      questionKey: "major",
      type: "short_text",
      label: "Your major",
      required: true,
      position: 1,
    },
    {
      formVersionId: version!.id,
      questionKey: "github",
      type: "url",
      label: "GitHub",
      position: 2,
    },
  ]);
  return committeeForm!.id;
}

beforeEach(async () => {
  await testDb.insert(user).values({
    id: "dchen",
    name: "Dana Chen",
    email: "dchen@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
  const [cycle] = await testDb
    .insert(recruitmentCycle)
    .values({
      slug: "spring-2027",
      name: "Spring 2027",
      status: "open",
      opensAt: past,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;

  for (const slug of ["labrador", "design"]) {
    const [t] = await testDb
      .insert(team)
      .values({ slug, name: slug, createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    const [opening] = await testDb
      .insert(recruitmentOpening)
      .values({
        cycleId,
        teamId: t!.id,
        status: "open",
        opensAt: past,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recruitmentOpening.id });
    if (slug === "labrador") {
      labradorOpening = opening!.id;
    } else {
      designOpening = opening!.id;
    }
    await publishCommitteeForm(opening!.id, t!.id);
  }

  const [common] = await testDb
    .insert(form)
    .values({ cycleId, kind: "common", title: "Common", createdAt: now, updatedAt: now })
    .returning({ id: form.id });
  commonFormId = common!.id;
  const [version] = await testDb
    .insert(formVersion)
    .values({
      formId: commonFormId,
      version: 1,
      status: "published",
      publishedAt: now,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: formVersion.id });
  await testDb.insert(question).values([
    {
      formVersionId: version!.id,
      questionKey: "major",
      type: "short_text",
      label: "Your major",
      required: true,
      position: 1,
    },
    {
      formVersionId: version!.id,
      questionKey: "github",
      type: "url",
      label: "GitHub",
      position: 2,
    },
  ]);
});

describe("GET /v1/me/profile", () => {
  it("creates the profile on first access", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app).get("/v1/me/profile").set(applicant.headers);

    // An applicant should not have to perform a setup step before they can
    // start. The profile is an implementation detail of "this person is
    // applying this cycle".
    expect(res.status).toBe(200);
    expect(res.body.cycleSlug).toBe("spring-2027");
    const profiles = await testDb.select().from(candidateProfile);
    expect(profiles).toHaveLength(1);
  });

  it("returns the same profile on a second access", async () => {
    const applicant = await seedApplicant("aquinn");

    await request(app).get("/v1/me/profile").set(applicant.headers);
    await request(app).get("/v1/me/profile").set(applicant.headers);

    const profiles = await testDb.select().from(candidateProfile);
    expect(profiles).toHaveLength(1);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get("/v1/me/profile");

    expect(res.status).toBe(401);
  });

  it("does not treat a cycle with no opening date as the current one", async () => {
    const applicant = await seedApplicant("aquinn");
    // The state a freshly created draft cycle is in: no dates yet.
    await testDb.insert(recruitmentCycle).values({
      slug: "fall-2027",
      name: "Fall 2027",
      status: "draft",
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get("/v1/me/profile").set(applicant.headers);

    // `ORDER BY opens_at DESC` puts NULLs first in Postgres, so without an
    // explicit filter an org admin creating next season would silently move
    // every current applicant onto it.
    expect(res.body.cycleSlug).toBe("spring-2027");
  });

  it("does not treat a later draft cycle as the current one", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.insert(recruitmentCycle).values({
      slug: "fall-2027",
      name: "Fall 2027",
      status: "draft",
      opensAt: new Date(Date.now() + 90 * 86_400_000),
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    });

    // A draft cycle is not announced. Its name and dates are not an applicant's
    // to know, and naming it as current would also detach them from the cycle
    // they are actually applying to.
    const res = await request(app).get("/v1/me/profile").set(applicant.headers);

    expect(res.body.cycleSlug).toBe("spring-2027");
    expect(JSON.stringify(res.body)).not.toContain("Fall 2027");
  });

  it("does not treat an announced but unopened cycle as the current one", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.insert(recruitmentCycle).values({
      slug: "fall-2027",
      name: "Fall 2027",
      status: "scheduled",
      opensAt: new Date(Date.now() + 90 * 86_400_000),
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get("/v1/me/profile").set(applicant.headers);

    expect(res.body.cycleSlug).toBe("spring-2027");
  });

  it("reports that there is no cycle rather than naming a hidden one", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.update(recruitmentCycle).set({ status: "draft" });

    // Every cycle is hidden. 404 is the honest answer; naming the draft would
    // disclose it, and a 500 would blame the server for a correct request.
    const res = await request(app).get("/v1/me/profile").set(applicant.headers);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("spring-2027");
  });

  it("refuses a token whose subject matches no account", async () => {
    // A perfectly valid token for somebody we have never seen. This is the
    // shape of a first sign-in before the auth callback has written the row.
    const { authHeader } = await import("./fixtures.ts");

    const res = await request(app)
      .get("/v1/me/profile")
      .set(authHeader({ sub: "nobody-sub" }));

    expect(res.status).toBe(401);
  });
});

describe("POST /v1/me/applications", () => {
  it("creates a draft application for an open opening", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Draft");
  });

  it("returns the existing draft rather than failing, if one already exists", async () => {
    const applicant = await seedApplicant("aquinn");
    const first = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    const second = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    // Somebody clicking Apply twice, or returning to the committee page, should
    // land on the application they already started — not an error telling them
    // they cannot apply to a committee they are mid-way through applying to.
    expect(second.status).toBe(200);
    expect(second.body.applicationId).toBe(first.body.applicationId);
  });

  it("refuses an opening in a cycle that has closed", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.update(recruitmentCycle).set({ status: "closed" });

    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    expect(res.status).toBe(409);
  });

  it("refuses an opening that has not opened yet", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb
      .update(recruitmentOpening)
      .set({ opensAt: new Date(Date.now() + 86_400_000) })
      .where(eq(recruitmentOpening.id, labradorOpening));

    // The committee has not opened. Checking the cycle alone would let somebody
    // start an application a week early.
    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    expect(res.status).toBe(409);
  });

  it("refuses an opening whose committee has not published a form", async () => {
    const applicant = await seedApplicant("aquinn");
    const [t] = await testDb
      .insert(team)
      .values({ slug: "events", name: "Events", createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    const [bare] = await testDb
      .insert(recruitmentOpening)
      .values({
        cycleId,
        teamId: t!.id,
        status: "open",
        opensAt: past,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recruitmentOpening.id });

    // The committee declared itself open without publishing questions. Letting
    // somebody start would hand them an application they cannot fill in, and
    // the failure would surface later as an unexplained 404 on save.
    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: bare!.id });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not ready/i);
  });

  it("refuses an opening that does not exist", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(404);
  });

  it("respects the cycle's limit on committees per applicant", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.update(recruitmentCycle).set({ maxCommitteesPerApplicant: 1 });
    await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: designOpening });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 committee/i);
  });
});

describe("deadlines and application state", () => {
  async function startApplication(headers: Record<string, string>) {
    const res = await request(app)
      .post("/v1/me/applications")
      .set(headers)
      .send({ openingId: labradorOpening });
    return res.body.applicationId as string;
  }

  it("refuses a new application once the cycle deadline has passed", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.update(recruitmentCycle).set({ closesAt: passedDeadline });

    // The status still says open — a transition job may not have run yet, or
    // nobody flipped it. The deadline is the authority, which is the whole
    // point of evaluating it server-side.
    const res = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    expect(res.status).toBe(409);
  });

  it("refuses a draft save once the cycle deadline has passed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb.update(recruitmentCycle).set({ closesAt: passedDeadline });

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Too late" }] });

    expect(res.status).toBe(409);
  });

  it("refuses a draft save once the committee's own deadline has passed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb
      .update(recruitmentOpening)
      .set({ closesAt: passedDeadline })
      .where(eq(recruitmentOpening.id, labradorOpening));

    // A committee may close earlier than the cycle. Checking only the cycle
    // would let somebody keep editing after their committee had stopped.
    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Too late" }] });

    expect(res.status).toBe(409);
  });

  it("refuses a draft save on a withdrawn application", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers);

    // Withdrawing means "do not consider me". Editing afterwards would put work
    // in front of a committee for an application the applicant had retracted.
    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Back again" }] });

    expect(res.status).toBe(409);
  });

  it("refuses a draft save once the application has been submitted", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb
      .update(application)
      .set({ status: "submitted", submittedAt: now })
      .where(eq(application.id, applicationId));

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Edited after" }] });

    expect(res.status).toBe(409);
  });

  it("allows withdrawing while a decision is unreleased, and says nothing about it", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb
      .update(application)
      .set({ status: "decided" })
      .where(eq(application.id, applicationId));

    const res = await request(app)
      .post(`/v1/me/applications/${applicationId}/withdraw`)
      .set(applicant.headers);

    // Refusing here would be an oracle: `projectStatus` hides `decided` as
    // "Under Review" until release, and a refusal saying a decision exists
    // would tell the applicant exactly what that hiding is for. Before release
    // their application reads as under review, so withdrawing from
    // consideration is a legitimate act and is simply accepted.
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/decision|decided/i);
  });

  it("records the status the application actually moved from", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);

    await request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers);

    // Postgres `RETURNING` yields the *new* row, so reading `status` from it
    // gives back "withdrawn" — the value just written. An audit row saying an
    // application moved from withdrawn to withdrawn records nothing.
    const [event] = await testDb.select().from(applicationStatusEvent);
    expect(event!.oldStatus).toBe("draft");
  });

  it("records a decided application as moving from decided", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb
      .update(application)
      .set({ status: "decided" })
      .where(eq(application.id, applicationId));

    await request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers);

    const [event] = await testDb
      .select()
      .from(applicationStatusEvent)
      .where(eq(applicationStatusEvent.event, "withdrawn"));
    expect(event!.oldStatus).toBe("decided");
  });

  it("keeps the decision in the history after an unreleased withdrawal", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb.insert(applicationStatusEvent).values({
      applicationId,
      oldStatus: "shortlisted",
      newStatus: "decided",
      event: "offered",
      changedBy: "dchen",
      createdAt: now,
    });
    await testDb
      .update(application)
      .set({ status: "decided" })
      .where(eq(application.id, applicationId));

    await request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers);

    // The status column moves to `withdrawn`, but the committee's decision is
    // an append-only event and stays. Nothing a committee concluded is erased.
    const events = await testDb.select().from(applicationStatusEvent);
    expect(events.map((e) => e.event).sort()).toEqual(["offered", "withdrawn"]);
  });

  it("refuses to withdraw once the decision has been released", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb
      .update(application)
      .set({ status: "decided" })
      .where(eq(application.id, applicationId));
    await testDb
      .update(recruitmentCycle)
      .set({ status: "decisions_released", decisionsReleasedAt: now });

    // Now the applicant can see the decision, so saying so reveals nothing —
    // and withdrawing is the wrong act. Declining an offer is its own event
    // with its own meaning for the committee's headcount.
    const res = await request(app)
      .post(`/v1/me/applications/${applicationId}/withdraw`)
      .set(applicant.headers);

    expect(res.status).toBe(409);
  });

  it("refuses to withdraw in an archived cycle", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb.update(recruitmentCycle).set({ status: "archived" });

    const res = await request(app)
      .post(`/v1/me/applications/${applicationId}/withdraw`)
      .set(applicant.headers);

    expect(res.status).toBe(409);
  });

  it("allows withdrawing after the deadline, because that is removing yourself", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb.update(recruitmentCycle).set({ status: "reviewing" });

    // Deliberately more permissive than editing. "Please do not consider me" is
    // reasonable after a deadline; changing your answers is not.
    const res = await request(app)
      .post(`/v1/me/applications/${applicationId}/withdraw`)
      .set(applicant.headers);

    expect(res.status).toBe(200);
  });

  it("records one event when two withdrawals arrive together", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);

    // The check was outside the transaction, so two in flight at once could
    // both pass it and both write an event — making the history say it happened
    // twice.
    await Promise.all([
      request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers),
      request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers),
    ]);

    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(1);
  });

  it("holds the committee cap when two applications are created together", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb.update(recruitmentCycle).set({ maxCommitteesPerApplicant: 1 });
    // Make the profile exist first, so both requests race the cap rather than
    // the profile's own unique index.
    await request(app).get("/v1/me/profile").set(applicant.headers);

    await Promise.all([
      request(app)
        .post("/v1/me/applications")
        .set(applicant.headers)
        .send({ openingId: labradorOpening }),
      request(app)
        .post("/v1/me/applications")
        .set(applicant.headers)
        .send({ openingId: designOpening }),
    ]);

    // Counting and then inserting is two steps. Both could pass the count.
    const rows = await testDb.select().from(application);
    expect(rows).toHaveLength(1);
  });
});

describe("PATCH /v1/me/applications/:id/draft", () => {
  async function startApplication(headers: Record<string, string>) {
    const res = await request(app)
      .post("/v1/me/applications")
      .set(headers)
      .send({ openingId: labradorOpening });
    return res.body.applicationId as string;
  }

  it("saves answers and advances the revision", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Computer Science" }] });

    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(1);
    expect(res.body.savedAt).toBeTruthy();
  });

  it("refuses a stale revision and reports the current one", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "First" }] });

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Second" }] });

    // A laptop and a phone both autosaving is the ordinary case. Taking the
    // last write would lose whatever the slower tab did not have.
    expect(res.status).toBe(409);
    expect(res.body.currentRevision).toBe(1);
  });

  it("leaves the stored answers untouched when it refuses a stale write", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "First" }] });

    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Second" }] });

    const res = await request(app)
      .get(`/v1/me/applications/${applicationId}`)
      .set(applicant.headers);
    expect(res.body.answers.major).toBe("First");
  });

  it("accepts a partial save without erasing answers it did not mention", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({
        revision: 0,
        answers: [
          { questionKey: "major", value: "Computer Science" },
          { questionKey: "github", value: "https://github.com/example" },
        ],
      });

    // Autosave sends what changed. A save that silently dropped the rest would
    // destroy work with every keystroke in a different field.
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "major", value: "Statistics" }] });

    const res = await request(app)
      .get(`/v1/me/applications/${applicationId}`)
      .set(applicant.headers);
    expect(res.body.answers.major).toBe("Statistics");
    expect(res.body.answers.github).toBe("https://github.com/example");
  });

  it("ignores an answer to a question that is not on the form", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "injected", value: "x" }] });

    // A client can send anything. Only what the published form defines is
    // stored, and the composite foreign key would refuse the rest anyway.
    expect(res.status).toBe(200);
    const stored = await testDb.select().from(formResponse);
    expect(stored).toHaveLength(1);
  });

  it("accepts a draft that would not pass submission validation", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);

    // A draft is work in progress. Refusing to save a half-finished answer
    // would mean somebody loses it by walking away from their desk.
    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "github", value: "not-a-url" }] });

    expect(res.status).toBe(200);
  });

  it("refuses to reach another applicant's application", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const applicationId = await startApplication(owner.headers);

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(other.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Hijacked" }] });

    // 404, not 403. Telling somebody an application exists that they may not
    // touch is itself a disclosure.
    expect(res.status).toBe(404);
  });

  it("refuses a write once the cycle is archived", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await startApplication(applicant.headers);
    await testDb.update(recruitmentCycle).set({ status: "archived" });

    const res = await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Too late" }] });

    expect(res.status).toBe(409);
  });
});

describe("PATCH /v1/me/common-response/draft", () => {
  it("saves the common answers once for the cycle", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .patch("/v1/me/common-response/draft")
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Computer Science" }] });

    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(1);
  });

  it("refuses to change the common answers once they are locked", async () => {
    const applicant = await seedApplicant("aquinn");
    await request(app).get("/v1/me/profile").set(applicant.headers);
    await testDb.update(candidateProfile).set({ commonLockedAt: now });

    // Editing these after a submission would retroactively change an
    // application a committee has already read.
    const res = await request(app)
      .patch("/v1/me/common-response/draft")
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Changed" }] });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/locked/i);
  });
});

describe("GET /v1/me/applications", () => {
  it("lists only the caller's own applications", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    await request(app)
      .post("/v1/me/applications")
      .set(owner.headers)
      .send({ openingId: labradorOpening });
    await request(app)
      .post("/v1/me/applications")
      .set(other.headers)
      .send({ openingId: designOpening });

    const res = await request(app).get("/v1/me/applications").set(owner.headers);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].committeeName).toBe("labrador");
  });

  it("shows a projected status, never the internal one", async () => {
    const applicant = await seedApplicant("aquinn");
    const create = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });
    await testDb
      .update(application)
      .set({ status: "shortlisted" })
      .where(eq(application.id, create.body.applicationId));

    const res = await request(app).get("/v1/me/applications").set(applicant.headers);

    // `shortlisted` is an internal state. An applicant learning they are on a
    // shortlist before a decision is released would be a disclosure with real
    // consequences for them.
    expect(res.body[0].status).toBe("Under Review");
    expect(JSON.stringify(res.body)).not.toContain("shortlisted");
  });
});

describe("POST /v1/me/applications/:id/withdraw", () => {
  it("withdraws the application and records the event", async () => {
    const applicant = await seedApplicant("aquinn");
    const create = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    const res = await request(app)
      .post(`/v1/me/applications/${create.body.applicationId}/withdraw`)
      .set(applicant.headers);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Withdrawn");
    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("withdrawn");
    // The applicant's own act, so no staff member is named as the actor.
    expect(events[0]!.changedBy).toBeNull();
  });

  it("refuses to withdraw another applicant's application", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const create = await request(app)
      .post("/v1/me/applications")
      .set(owner.headers)
      .send({ openingId: labradorOpening });

    const res = await request(app)
      .post(`/v1/me/applications/${create.body.applicationId}/withdraw`)
      .set(other.headers);

    expect(res.status).toBe(404);
  });

  it("is idempotent, so a double click does not error", async () => {
    const applicant = await seedApplicant("aquinn");
    const create = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });
    await request(app)
      .post(`/v1/me/applications/${create.body.applicationId}/withdraw`)
      .set(applicant.headers);

    const res = await request(app)
      .post(`/v1/me/applications/${create.body.applicationId}/withdraw`)
      .set(applicant.headers);

    expect(res.status).toBe(200);
    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(1);
  });
});
