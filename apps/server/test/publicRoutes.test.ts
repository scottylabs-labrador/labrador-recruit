/**
 * The public routes.
 *
 * These power the landing page before anybody signs in, so the rule is simple:
 * they return only what a poster on a wall could say. No applicant data, no
 * counts of applicants, no form contents, and nothing about a cycle that has
 * not been announced.
 */
import {
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
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

let cycleId: string;
let labradorOpening: string;

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
      description: "Apply to ScottyLabs committees.",
      status: "open",
      timeZone: "America/New_York",
      opensAt: past,
      closesAt: future,
      maxCommitteesPerApplicant: 3,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;

  const [labrador] = await testDb
    .insert(team)
    .values({
      slug: "labrador",
      name: "Labrador",
      description: "Product teams building for the CMU community.",
      displayOrder: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: team.id });
  const [opening] = await testDb
    .insert(recruitmentOpening)
    .values({
      cycleId,
      teamId: labrador!.id,
      status: "open",
      opensAt: past,
      capacity: 8,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentOpening.id });
  labradorOpening = opening!.id;
});

describe("GET /v1/cycles/current", () => {
  it("describes the open cycle without authentication", async () => {
    const res = await request(app).get("/v1/cycles/current");

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("spring-2027");
    expect(res.body.name).toBe("Spring 2027");
    expect(res.body.closesAt).toBeTruthy();
    expect(res.body.timeZone).toBe("America/New_York");
  });

  it("reveals nothing about applicants", async () => {
    const applicant = await seedApplicant("aquinn");
    await testDb
      .insert(candidateProfile)
      .values({ userId: applicant.andrewId, cycleId, createdAt: now, updatedAt: now });

    const res = await request(app).get("/v1/cycles/current");

    // A count of applicants is competitive information an applicant should not
    // be weighing, and it is not ours to publish.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("aquinn");
    expect(body.toLowerCase()).not.toContain("applicantcount");
  });

  it("says there is no cycle rather than naming a draft one", async () => {
    await testDb.update(recruitmentCycle).set({ status: "draft" });

    const res = await request(app).get("/v1/cycles/current");

    // A draft cycle is not announced. Its name and dates are not public, and a
    // 404 that says nothing is the honest answer.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("spring-2027");
  });

  it("does not announce a cycle before it opens", async () => {
    await testDb.update(recruitmentCycle).set({
      status: "scheduled",
      opensAt: future,
      // Further out than `opensAt`, because `recruitment_cycle_window_ck`
      // requires it — reusing `future` for both is a row the database refuses,
      // correctly.
      closesAt: new Date(future.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get("/v1/cycles/current");

    expect(res.status).toBe(404);
  });
});

describe("GET /v1/openings", () => {
  it("lists committees that are recruiting", async () => {
    const res = await request(app).get("/v1/openings");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].teamName).toBe("Labrador");
    expect(res.body[0].teamSlug).toBe("labrador");
    expect(res.body[0].description).toContain("CMU community");
    expect(res.body[0].accepting).toBe(true);
  });

  it("includes a committee that has not opened, with its opening date", async () => {
    const [t] = await testDb
      .insert(team)
      .values({ slug: "design", name: "Design", displayOrder: 2, createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    await testDb.insert(recruitmentOpening).values({
      cycleId,
      teamId: t!.id,
      status: "open",
      opensAt: future,
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get("/v1/openings");

    // The landing page shows the upcoming date rather than an Apply button. A
    // button that leads to a closed form is worse than no button, and hiding
    // the committee entirely would make somebody think it is not recruiting.
    const design = res.body.find((row: { teamSlug: string }) => row.teamSlug === "design");
    expect(design.accepting).toBe(false);
    expect(design.opensAt).toBeTruthy();
  });

  it("omits a committee whose opening is still a draft", async () => {
    const [t] = await testDb
      .insert(team)
      .values({ slug: "events", name: "Events", displayOrder: 3, createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    await testDb.insert(recruitmentOpening).values({
      cycleId,
      teamId: t!.id,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get("/v1/openings");

    // A draft opening is a director still deciding. Publishing it would
    // announce a committee's intentions before they have.
    expect(res.body.map((row: { teamSlug: string }) => row.teamSlug)).not.toContain("events");
  });

  it("orders committees by their display order", async () => {
    const [t] = await testDb
      .insert(team)
      .values({ slug: "design", name: "Design", displayOrder: 0, createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    await testDb.insert(recruitmentOpening).values({
      cycleId,
      teamId: t!.id,
      status: "open",
      opensAt: past,
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get("/v1/openings");

    expect(res.body.map((row: { teamSlug: string }) => row.teamSlug)).toEqual([
      "design",
      "labrador",
    ]);
  });

  it("reveals no applicant counts", async () => {
    const applicant = await seedApplicant("aquinn");
    const [profile] = await testDb
      .insert(candidateProfile)
      .values({ userId: applicant.andrewId, cycleId, createdAt: now, updatedAt: now })
      .returning({ id: candidateProfile.id });
    await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    const res = await request(app).get("/v1/openings");

    // How many people have applied is exactly the thing an applicant would
    // weigh and exactly the thing it is not ours to tell them.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(profile!.id);
    expect(body.toLowerCase()).not.toMatch(/applicant|applications/);
  });

  it("returns an empty list rather than failing when no cycle is open", async () => {
    await testDb.update(recruitmentCycle).set({ status: "draft" });

    const res = await request(app).get("/v1/openings");

    // The landing page renders "nothing is recruiting" from this. A 404 would
    // make it render an error instead, for an entirely ordinary state.
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /v1/me/common-response", () => {
  async function publishCommonForm() {
    const [row] = await testDb
      .insert(form)
      .values({ cycleId, kind: "common", title: "Common", createdAt: now, updatedAt: now })
      .returning({ id: form.id });
    const [version] = await testDb
      .insert(formVersion)
      .values({
        formId: row!.id,
        version: 1,
        status: "published",
        publishedAt: now,
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: formVersion.id });
    await testDb.insert(question).values({
      formVersionId: version!.id,
      questionKey: "major",
      type: "short_text",
      label: "Your major",
      required: true,
      position: 1,
    });
    return row!.id;
  }

  it("returns the form and an empty answer set before anything is saved", async () => {
    const applicant = await seedApplicant("aquinn");
    const formId = await publishCommonForm();

    const res = await request(app).get("/v1/me/common-response").set(applicant.headers);

    // The page needs the questions and the revision to start from, and an
    // applicant who has not begun is the ordinary first case rather than an
    // error.
    expect(res.status).toBe(200);
    expect(res.body.formId).toBe(formId);
    expect(res.body.revision).toBe(0);
    expect(res.body.answers).toEqual({});
    expect(res.body.locked).toBe(false);
  });

  it("returns saved answers with the revision to send back", async () => {
    const applicant = await seedApplicant("aquinn");
    await publishCommonForm();
    await request(app)
      .patch("/v1/me/common-response/draft")
      .set(applicant.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Computer Science" }] });

    const res = await request(app).get("/v1/me/common-response").set(applicant.headers);

    expect(res.body.answers.major).toBe("Computer Science");
    expect(res.body.revision).toBe(1);
  });

  it("reports that the answers are locked once a submission has happened", async () => {
    const applicant = await seedApplicant("aquinn");
    await publishCommonForm();
    await request(app).get("/v1/me/profile").set(applicant.headers);
    await testDb.update(candidateProfile).set({ commonLockedAt: now });

    const res = await request(app).get("/v1/me/common-response").set(applicant.headers);

    // Locked means unchangeable, not invisible. The page renders read-only and
    // has to be told which.
    expect(res.body.locked).toBe(true);
    expect(res.body.answers).toBeDefined();
  });

  it("refuses an unauthenticated caller", async () => {
    await publishCommonForm();

    const res = await request(app).get("/v1/me/common-response");

    expect(res.status).toBe(401);
  });

  it("never returns another applicant's answers", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    await publishCommonForm();
    await request(app)
      .patch("/v1/me/common-response/draft")
      .set(owner.headers)
      .send({ revision: 0, answers: [{ questionKey: "major", value: "Theirs" }] });

    const res = await request(app).get("/v1/me/common-response").set(other.headers);

    expect(res.body.answers).toEqual({});
    expect(JSON.stringify(res.body)).not.toContain("Theirs");
    expect(formResponse).toBeTruthy();
    expect(eq).toBeTruthy();
  });
});
