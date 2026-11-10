/**
 * Form authoring: drafts, questions, and publishing.
 *
 * #17 calls this the most important backend issue in the project, and the
 * reason is that three invariants meet here and nothing downstream can recover
 * if any of them slips:
 *
 * 1. **A published version is immutable.** `form_response` names the exact
 *    version it was answered against, so this is what keeps an answer readable
 *    against the question as it was actually asked. Postgres has no "no further
 *    updates" constraint short of a trigger, so it is enforced here — which
 *    means it needs a test that tries and fails, not a convention.
 * 2. **Publishing is a director power.** A question editor has no publish route
 *    at all.
 * 3. **A visibility rule may only reference an earlier question in the same
 *    version.** Checked at publish, because it is cheap there and impossible to
 *    recover from afterwards.
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
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { seedApplicant, seedStaff } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const now = new Date();
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

let cycleId: string;
let labradorId: string;
let designId: string;
let labradorOpening: string;
let labradorForm: string;
let commonForm: string;

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
      closesAt: future,
      createdBy: "dchen",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;

  const teams = await testDb
    .insert(team)
    .values([
      { slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now },
      { slug: "design", name: "Design", createdAt: now, updatedAt: now },
    ])
    .returning({ id: team.id, slug: team.slug });
  labradorId = teams.find((row) => row.slug === "labrador")!.id;
  designId = teams.find((row) => row.slug === "design")!.id;

  const [opening] = await testDb
    .insert(recruitmentOpening)
    .values({
      cycleId,
      teamId: labradorId,
      status: "open",
      opensAt: past,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentOpening.id });
  labradorOpening = opening!.id;

  const [committee] = await testDb
    .insert(form)
    .values({
      cycleId,
      teamId: labradorId,
      openingId: labradorOpening,
      kind: "committee",
      title: "Labrador application",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: form.id });
  labradorForm = committee!.id;

  const [shared] = await testDb
    .insert(form)
    .values({ cycleId, kind: "common", title: "Shared questions", createdAt: now, updatedAt: now })
    .returning({ id: form.id });
  commonForm = shared!.id;
});

/** The director of Labrador, who may both edit and publish. */
function director() {
  return seedStaff("mokafor", { role: "committee_director", teamId: labradorId, cycleId });
}

/** An editor on Labrador, who may edit and must never publish. */
function editor() {
  return seedStaff("pvarma", { role: "question_editor", teamId: labradorId, cycleId });
}

async function addQuestion(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  formId = labradorForm,
) {
  return await request(app).post(`/v1/forms/${formId}/questions`).set(headers).send(body);
}

const SHORT_TEXT = {
  questionKey: "major",
  type: "short_text",
  label: "Your major",
  required: true,
};

describe("reading a draft", () => {
  it("creates the first draft on demand, so a new form is editable", async () => {
    const staff = await editor();

    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`).set(staff.headers);

    // A form with no version at all is the ordinary starting state. Making the
    // builder POST a version before it can show anything would be ceremony.
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.status).toBe("draft");
    expect(res.body.questions).toEqual([]);
  });

  it("returns the same draft on a second read rather than a second version", async () => {
    const staff = await editor();
    await request(app).get(`/v1/forms/${labradorForm}/draft`).set(staff.headers);

    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`).set(staff.headers);

    expect(res.body.version).toBe(1);
    expect(await testDb.select().from(formVersion)).toHaveLength(1);
  });

  it("refuses a caller with no grant on that committee", async () => {
    const staff = await seedStaff("jtanaka", {
      role: "committee_director",
      teamId: designId,
      cycleId,
    });

    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`).set(staff.headers);

    // 404, not 403: a Design director probing a Labrador form id learns
    // nothing about whether it exists.
    expect(res.status).toBe(404);
  });

  it("refuses an applicant outright", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`).set(applicant.headers);

    /*
     * **An applicant can never fetch a draft version.** A draft is a
     * director's work in progress; its questions have not been asked yet, and
     * seeing them early is an advantage nobody else has.
     */
    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`);

    expect(res.status).toBe(401);
  });
});

describe("authoring questions", () => {
  it("adds a question at the end", async () => {
    const staff = await editor();

    const res = await addQuestion(staff.headers, SHORT_TEXT);

    expect(res.status).toBe(201);
    expect(res.body.position).toBe(1);
    const [row] = await testDb.select().from(question);
    expect(row!.questionKey).toBe("major");
  });

  it("refuses a duplicate question key within one version", async () => {
    const staff = await editor();
    await addQuestion(staff.headers, SHORT_TEXT);

    const res = await addQuestion(staff.headers, SHORT_TEXT);

    // A key is how an answer finds its question. Two of them in one version
    // would make a stored answer ambiguous.
    expect(res.status).toBe(409);
  });

  it("refuses a question type that does not exist", async () => {
    const staff = await editor();

    const res = await addQuestion(staff.headers, { ...SHORT_TEXT, type: "essay" });

    expect(res.status).toBe(422);
  });

  it("refuses a select with no choices", async () => {
    const staff = await editor();

    const res = await addQuestion(staff.headers, {
      questionKey: "year",
      type: "single_select",
      label: "Year",
      config: { choices: [] },
    });

    // A select nobody can answer is a form nobody can submit, and the publish
    // check would catch it later — but telling the director now is better.
    expect(res.status).toBe(422);
  });

  it("never marks a section heading required", async () => {
    const staff = await editor();

    const res = await addQuestion(staff.headers, {
      questionKey: "part-one",
      type: "section_heading",
      label: "Part one",
      required: true,
    });

    /*
     * `required: true` on a heading is a misconfiguration, not an
     * instruction — it carries no answer, so nothing could ever satisfy it and
     * the form would be unsubmittable. Normalised rather than refused, because
     * the director's intent is obvious.
     */
    expect(res.status).toBe(201);
    const [row] = await testDb.select().from(question);
    expect(row!.required).toBe(false);
  });

  it("updates a draft question", async () => {
    const staff = await editor();
    const created = await addQuestion(staff.headers, SHORT_TEXT);

    const res = await request(app)
      .patch(`/v1/questions/${created.body.questionId}`)
      .set(staff.headers)
      .send({ label: "Your major or intended major" });

    expect(res.status).toBe(200);
    const [row] = await testDb.select().from(question);
    expect(row!.label).toBe("Your major or intended major");
  });

  it("deletes a draft question", async () => {
    const staff = await editor();
    const created = await addQuestion(staff.headers, SHORT_TEXT);

    const res = await request(app)
      .delete(`/v1/questions/${created.body.questionId}`)
      .set(staff.headers);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(question)).toHaveLength(0);
  });

  it("reorders questions", async () => {
    const staff = await editor();
    const first = await addQuestion(staff.headers, SHORT_TEXT);
    const second = await addQuestion(staff.headers, {
      questionKey: "essay",
      type: "long_text",
      label: "Why?",
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/reorder`)
      .set(staff.headers)
      .send({ questionIds: [second.body.questionId, first.body.questionId] });

    expect(res.status).toBe(200);
    const rows = await testDb.select().from(question).orderBy(question.position);
    expect(rows.map((row) => row.questionKey)).toEqual(["essay", "major"]);
  });

  it("refuses a reorder that omits a question", async () => {
    const staff = await editor();
    const first = await addQuestion(staff.headers, SHORT_TEXT);
    await addQuestion(staff.headers, { questionKey: "essay", type: "long_text", label: "Why?" });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/reorder`)
      .set(staff.headers)
      .send({ questionIds: [first.body.questionId] });

    // A partial order leaves the omitted question somewhere nobody chose, and
    // position decides both display order and the order rules evaluate in.
    expect(res.status).toBe(409);
  });

  it("refuses an editor on another committee", async () => {
    const staff = await seedStaff("other", {
      role: "question_editor",
      teamId: designId,
      cycleId,
    });

    const res = await addQuestion(staff.headers, SHORT_TEXT);

    expect(res.status).toBe(404);
  });

  it("refuses an applicant", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await addQuestion(applicant.headers, SHORT_TEXT);

    expect(res.status).toBe(404);
  });
});

describe("publishing", () => {
  async function draftWith(headers: Record<string, string>, questions: Record<string, unknown>[]) {
    for (const body of questions) {
      const res = await addQuestion(headers, body);
      expect(res.status).toBe(201);
    }
  }

  it("publishes a draft and freezes it", async () => {
    const boss = await director();
    await draftWith(boss.headers, [SHORT_TEXT]);

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    expect(res.status).toBe(200);
    const [row] = await testDb.select().from(formVersion);
    expect(row!.status).toBe("published");
    expect(row!.publishedAt).not.toBeNull();
  });

  it("refuses to publish an empty form", async () => {
    const boss = await director();
    await request(app).get(`/v1/forms/${labradorForm}/draft`).set(boss.headers);

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    // Publishing an empty form opens applications nobody can answer.
    expect(res.status).toBe(422);
  });

  it("gives a question editor no publish route at all", async () => {
    const staff = await editor();
    await draftWith(staff.headers, [SHORT_TEXT]);

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(staff.headers)
      .send({});

    /*
     * The narrowest grant in the model, and the one most likely to be widened
     * by accident. A published version is what applicants answer against and
     * cannot be withdrawn, so publishing is a director's act. Gated by the
     * ability, never by a role string comparison.
     */
    expect(res.status).toBe(404);
    expect((await testDb.select().from(formVersion))[0]!.status).toBe("draft");
  });

  it("refuses a director on another committee", async () => {
    const boss = await director();
    await draftWith(boss.headers, [SHORT_TEXT]);
    const other = await seedStaff("jtanaka", {
      role: "committee_director",
      teamId: designId,
      cycleId,
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(other.headers)
      .send({});

    expect(res.status).toBe(404);
  });

  it("lets an organization admin publish the common form", async () => {
    const admin = await seedStaff("dadmin", { role: "org_admin" });
    const created = await addQuestion(admin.headers, SHORT_TEXT, commonForm);
    expect(created.status).toBe(201);

    const res = await request(app)
      .post(`/v1/forms/${commonForm}/publish`)
      .set(admin.headers)
      .send({});

    // Common and committee forms are one system: same tables, same routes,
    // same validator. Only the owner differs.
    expect(res.status).toBe(200);
  });

  it("does not let a committee director publish the common form", async () => {
    const boss = await director();

    const res = await addQuestion(boss.headers, SHORT_TEXT, commonForm);

    expect(res.status).toBe(404);
  });
});

describe("a published version is immutable", () => {
  async function publishedForm(headers: Record<string, string>) {
    const created = await addQuestion(headers, SHORT_TEXT);
    await request(app).post(`/v1/forms/${labradorForm}/publish`).set(headers).send({});
    return created.body.questionId as string;
  }

  it("refuses to update a published question", async () => {
    const boss = await director();
    const questionId = await publishedForm(boss.headers);

    const res = await request(app)
      .patch(`/v1/questions/${questionId}`)
      .set(boss.headers)
      .send({ label: "Something else entirely" });

    /*
     * **The central integrity rule of the product.**
     *
     * A `form_response` names the exact version it was answered against, so a
     * published question changing underneath it would make every stored answer
     * a reply to a question nobody asked. Postgres has no "no further updates"
     * constraint short of a trigger, so this is enforced in the service — and
     * therefore needs a test that tries it and fails, rather than a
     * convention.
     */
    expect(res.status).toBe(409);
    const [row] = await testDb.select().from(question);
    expect(row!.label).toBe("Your major");
  });

  it("refuses to delete a published question", async () => {
    const boss = await director();
    const questionId = await publishedForm(boss.headers);

    const res = await request(app).delete(`/v1/questions/${questionId}`).set(boss.headers);

    expect(res.status).toBe(409);
    expect(await testDb.select().from(question)).toHaveLength(1);
  });

  it("refuses to reorder a published version", async () => {
    const boss = await director();
    const questionId = await publishedForm(boss.headers);

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/reorder`)
      .set(boss.headers)
      .send({ questionIds: [questionId] });

    // Position decides the order rules evaluate in, so reordering a published
    // version could change which questions a stored answer set made visible.
    expect(res.status).toBe(409);
  });

  it("refuses to publish the same version twice", async () => {
    const boss = await director();
    await publishedForm(boss.headers);

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    expect(res.status).toBe(409);
  });

  it("starts a new draft copying the published questions, leaving them alone", async () => {
    const boss = await director();
    await publishedForm(boss.headers);

    const res = await request(app).get(`/v1/forms/${labradorForm}/draft`).set(boss.headers);

    /*
     * Editing after publication creates version 2, pre-filled from version 1.
     *
     * Copying is what makes the immutability liveable: a director who wants to
     * fix a typo does not retype the whole form, and version 1 stays exactly
     * as answered.
     */
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.status).toBe("draft");
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].questionKey).toBe("major");

    const versions = await testDb.select().from(formVersion).orderBy(formVersion.version);
    expect(versions.map((row) => row.status)).toEqual(["published", "draft"]);
    // The published version's own question is untouched and still belongs to it.
    expect(await testDb.select().from(question)).toHaveLength(2);
  });

  it("allows only one draft per form", async () => {
    const boss = await director();
    await publishedForm(boss.headers);
    await request(app).get(`/v1/forms/${labradorForm}/draft`).set(boss.headers);

    await request(app).get(`/v1/forms/${labradorForm}/draft`).set(boss.headers);

    // The database enforces this with a partial unique index; the service must
    // not be trying to create a second one in the first place.
    const drafts = await testDb.select().from(formVersion).where(eq(formVersion.status, "draft"));
    expect(drafts).toHaveLength(1);
  });

  it("serves the published version to applicants while a draft exists", async () => {
    const boss = await director();
    await publishedForm(boss.headers);
    await request(app).get(`/v1/forms/${labradorForm}/draft`).set(boss.headers);
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .get(`/v1/forms/${labradorForm}/published`)
      .set(applicant.headers);

    // The draft is invisible and the published version keeps serving. A
    // director half-way through an edit must not change what applicants see.
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.questions).toHaveLength(1);
  });
});

describe("visibility rules are checked at publish", () => {
  it("refuses a rule referencing a later question, naming the key", async () => {
    const boss = await director();
    await addQuestion(boss.headers, {
      questionKey: "transferFrom",
      type: "short_text",
      label: "Which school did you transfer from?",
      visibilityRule: { equals: { questionKey: "year", value: "Junior" } },
    });
    await addQuestion(boss.headers, {
      questionKey: "year",
      type: "single_select",
      label: "Year",
      config: { choices: ["Junior", "Senior"] },
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    /*
     * `evaluateVisibility` is a single pass in position order, so a rule
     * depending on a later answer can never be satisfied — the question would
     * be permanently hidden and the director would have no idea why.
     *
     * Cheap to catch here and impossible to recover from afterwards, which is
     * why it is a publish-time check. The message names the offending key,
     * because "invalid visibility rule" on a form with forty questions is not
     * actionable.
     */
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("year");
  });

  it("refuses a rule referencing a question that does not exist", async () => {
    const boss = await director();
    await addQuestion(boss.headers, {
      ...SHORT_TEXT,
      visibilityRule: { equals: { questionKey: "nothing-like-this", value: "x" } },
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    // Which covers the cross-form case too: a key from another form is simply
    // a key this version does not have, and there is no syntax that could
    // name one.
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("nothing-like-this");
  });

  it("refuses a rule referencing itself", async () => {
    const boss = await director();
    await addQuestion(boss.headers, {
      ...SHORT_TEXT,
      visibilityRule: { equals: { questionKey: "major", value: "x" } },
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    expect(res.status).toBe(422);
  });

  it("accepts a rule referencing an earlier question", async () => {
    const boss = await director();
    await addQuestion(boss.headers, {
      questionKey: "year",
      type: "single_select",
      label: "Year",
      required: true,
      config: { choices: ["Junior", "Senior"] },
    });
    await addQuestion(boss.headers, {
      questionKey: "transferFrom",
      type: "short_text",
      label: "Which school did you transfer from?",
      visibilityRule: { equals: { questionKey: "year", value: "Junior" } },
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    expect(res.status).toBe(200);
  });

  it("refuses a choice value no longer on the question it depends on", async () => {
    const boss = await director();
    await addQuestion(boss.headers, {
      questionKey: "year",
      type: "single_select",
      label: "Year",
      config: { choices: ["Junior", "Senior"] },
    });
    await addQuestion(boss.headers, {
      questionKey: "transferFrom",
      type: "short_text",
      label: "Which school?",
      visibilityRule: { equals: { questionKey: "year", value: "Sophomore" } },
    });

    const res = await request(app)
      .post(`/v1/forms/${labradorForm}/publish`)
      .set(boss.headers)
      .send({});

    // Choice drift: the rule was written against a choice somebody later
    // removed, so the question is now permanently hidden. The same silent
    // failure as a forward reference, by a different route.
    expect(res.status).toBe(422);
  });
});
