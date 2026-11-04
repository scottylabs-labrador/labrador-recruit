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
import { testDb } from "./harness.ts";

const now = new Date();
let cycleId: string;

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
  await testDb
    .insert(recruitmentOpening)
    .values({ cycleId, teamId: t!.id, status: "open", createdAt: now, updatedAt: now });
});

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

    const res = await request(app).get(`/v1/forms/${formId}/published`);

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
    const res = await request(app).get(`/v1/forms/${formId}/published`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for a form that does not exist", async () => {
    const res = await request(app).get("/v1/forms/00000000-0000-0000-0000-000000000000/published");

    expect(res.status).toBe(404);
  });

  it("returns 404 while the cycle is still a draft", async () => {
    const formId = await seedForm({ publish: true, cycleStatus: "draft" });

    // The form is ready but the cycle is not announced. Serving it would let
    // somebody discover next season's questions early.
    const res = await request(app).get(`/v1/forms/${formId}/published`);

    expect(res.status).toBe(404);
  });

  it("serves an archived cycle's form, so a past application stays readable", async () => {
    const formId = await seedForm({ publish: true, cycleStatus: "archived" });

    const res = await request(app).get(`/v1/forms/${formId}/published`);

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

    const res = await request(app).get(`/v1/forms/${formId}/published`);

    expect(res.body.version).toBe(2);
    expect(res.body.questions).toHaveLength(1);
  });

  it("does not return internal row identifiers", async () => {
    const formId = await seedForm({ publish: true });

    const res = await request(app).get(`/v1/forms/${formId}/published`);

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

    const res = await request(app).get(`/v1/forms/${formId}/published`);

    const conditional = res.body.questions.find(
      (q: { questionKey: string }) => q.questionKey === "ai",
    );
    expect(conditional.visibilityRule).toEqual({ equals: { questionKey: "major", value: "CS" } });
  });

  it("is public, because the landing page shows a form before anybody signs in", async () => {
    const formId = await seedForm({ publish: true });

    // No session, no bearer token. A published form is what a poster on a wall
    // could say, and requiring sign-in to read the questions would turn away
    // applicants deciding whether to apply at all.
    const res = await request(app).get(`/v1/forms/${formId}/published`);

    expect(res.status).toBe(200);
  });
});
