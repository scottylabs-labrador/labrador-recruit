/**
 * The applicant's read of a published form.
 *
 * The one endpoint an applicant uses to see what they are being asked. It must
 * never serve a draft: a draft is a director's work in progress, and answers
 * attached to a version still being edited would have no stable meaning.
 */
import {
  form,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
  team,
  user,
} from "@recruit/db/schema";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { authHeader } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const now = new Date();
let cycleId: string;
let teamId: string;
let openingId: string;

/** Any authenticated CMU account, holding no authority whatsoever. */
const applicant = () => authHeader({ sub: "aquinn-sub" });

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
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;
  const [t] = await testDb
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  teamId = t!.id;
  const [opening] = await testDb
    .insert(recruitmentOpening)
    .values({ cycleId, teamId, status: "open", createdAt: now, updatedAt: now })
    .returning({ id: recruitmentOpening.id });
  openingId = opening!.id;
});

/** A published committee form, which hangs off an opening rather than the cycle. */
async function seedCommitteeForm(openingStatus: "draft" | "open" | "closed") {
  await testDb.update(recruitmentOpening).set({ status: openingStatus });
  const [row] = await testDb
    .insert(form)
    .values({
      cycleId,
      teamId,
      openingId,
      kind: "committee",
      title: "Labrador Application",
      createdAt: now,
      updatedAt: now,
    })
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
    questionKey: "why-labrador",
    type: "long_text",
    label: "Why Labrador",
    position: 1,
  });
  return row!.id;
}

async function seedForm(opts: { publish: boolean; cycleStatus?: "draft" | "open" | "archived" }) {
  if (opts.cycleStatus) {
    await testDb.update(recruitmentCycle).set({ status: opts.cycleStatus });
  }
  const [row] = await testDb
    .insert(form)
    .values({ cycleId, kind: "common", title: "Common", createdAt: now, updatedAt: now })
    .returning({ id: form.id });
  const [version] = await testDb
    .insert(formVersion)
    .values({
      formId: row!.id,
      version: 1,
      status: opts.publish ? "published" : "draft",
      publishedAt: opts.publish ? now : null,
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
      questionKey: "why",
      type: "long_text",
      label: "Why join",
      position: 2,
    },
  ]);
  return row!.id;
}

describe("GET /v1/forms/:formId/published", () => {
  it("returns the published version with its questions in order", async () => {
    const formId = await seedForm({ publish: true });

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Common");
    expect(res.body.questions.map((q: { questionKey: string }) => q.questionKey)).toEqual([
      "major",
      "why",
    ]);
  });

  it("returns 404 for a form whose only version is a draft", async () => {
    const formId = await seedForm({ publish: false });

    // Not 403. A draft is a director's work in progress, and telling an
    // applicant one exists leaks that a committee is preparing to recruit.
    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(404);
  });

  it("returns 404 for a form that does not exist", async () => {
    const res = await request(app)
      .get("/v1/forms/00000000-0000-0000-0000-000000000000/published")
      .set(applicant());

    expect(res.status).toBe(404);
  });

  it("returns 404 while the cycle is still a draft", async () => {
    const formId = await seedForm({ publish: true, cycleStatus: "draft" });

    // The form is ready but the cycle is not announced. Serving it would let
    // somebody discover next season's questions early.
    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(404);
  });

  it("serves an archived cycle's form, so a past application stays readable", async () => {
    const formId = await seedForm({ publish: true, cycleStatus: "archived" });

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(200);
  });

  it("serves the newest published version when there are several", async () => {
    const formId = await seedForm({ publish: true });
    const [second] = await testDb
      .insert(formVersion)
      .values({
        formId,
        version: 2,
        status: "published",
        publishedAt: new Date(now.getTime() + 1000),
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: formVersion.id });
    await testDb.insert(question).values({
      formVersionId: second!.id,
      questionKey: "new-question",
      type: "short_text",
      label: "Added later",
      position: 1,
    });

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.body.version).toBe(2);
    expect(res.body.questions).toHaveLength(1);
  });

  it("does not return internal row identifiers", async () => {
    const formId = await seedForm({ publish: true });

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    // A row id is no use to a browser and is one more thing to reason about if
    // it ever reaches a URL or a log line.
    expect(res.body.questions[0]).not.toHaveProperty("id");
    expect(res.body.questions[0]).not.toHaveProperty("formVersionId");
  });

  it("exposes a conditional rule, because the renderer needs it", async () => {
    const formId = await seedForm({ publish: true });
    const [version] = await testDb.select({ id: formVersion.id }).from(formVersion);
    await testDb.insert(question).values({
      formVersionId: version!.id,
      questionKey: "ai",
      type: "long_text",
      label: "AI project",
      position: 3,
      visibilityRuleJson: { equals: { questionKey: "major", value: "CS" } },
    });

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    const conditional = res.body.questions.find(
      (q: { questionKey: string }) => q.questionKey === "ai",
    );
    expect(conditional.visibilityRule).toEqual({ equals: { questionKey: "major", value: "CS" } });
  });

  it("refuses an unauthenticated caller", async () => {
    const formId = await seedForm({ publish: true });

    // `docs/api.md` section 3 puts this among the applicant routes. The landing
    // page needs committee names and descriptions, which `/v1/openings` serves
    // publicly — it does not need the whole question set, and publishing that
    // anonymously would expose every committee's question design, including
    // archived cycles, permanently.
    const res = await request(app).get(`/v1/forms/${formId}/published`);

    expect(res.status).toBe(401);
  });

  it("refuses a committee form whose opening is still a draft", async () => {
    const formId = await seedCommitteeForm("draft");

    // The cycle is open and the form is published, but this committee has not
    // opened. Those two states are independent on purpose, and checking only
    // the cycle would serve a form nobody is supposed to see yet.
    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(404);
  });

  it("serves a committee form once its opening is open", async () => {
    const formId = await seedCommitteeForm("open");

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("committee");
  });

  it("serves a committee form whose opening has closed, so a submitted application stays readable", async () => {
    const formId = await seedCommitteeForm("closed");

    const res = await request(app).get(`/v1/forms/${formId}/published`).set(applicant());

    expect(res.status).toBe(200);
  });

  it("returns 404 for an identifier that is not a uuid, rather than a 500", async () => {
    // An unvalidated id reaches Postgres, which errors on the cast — turning a
    // malformed request into a server fault, and into a 500 body describing the
    // query that failed.
    const res = await request(app).get("/v1/forms/not-a-uuid/published").set(applicant());

    expect(res.status).toBe(404);
  });
});
