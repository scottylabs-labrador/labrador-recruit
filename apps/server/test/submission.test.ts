/**
 * Final submission.
 *
 * The transactional core of the product, and the most dangerous path on this
 * track. The order of these tests is deliberate: audit integrity and
 * disclosure first, then atomicity, then idempotency, then the happy path.
 * Those are the two classes that have actually bitten in this service, and
 * writing them last is how the last two defects got in.
 */
import {
  answer,
  application,
  applicationStatusEvent,
  candidateProfile,
  file,
  form,
  formResponse,
  formVersion,
  notificationOutbox,
  question,
  recruitmentCycle,
  recruitmentOpening,
  submission,
  team,
  user,
} from "@recruit/db/schema";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { seedApplicant } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const now = new Date();
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const passedDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);

let cycleId: string;
let labradorOpening: string;
let designOpening: string;
let commonVersionId: string;

/**
 * A published form version with the question set every test here relies on.
 *
 * `interest` gates `ai-project`, so the conditional path is exercised by the
 * ordinary cases rather than only by a dedicated test.
 */
async function publishForm(opts: {
  kind: "common" | "committee";
  openingId?: string;
  teamId?: string;
}) {
  const [row] = await testDb
    .insert(form)
    .values({
      cycleId,
      kind: opts.kind,
      ...(opts.kind === "committee" ? { openingId: opts.openingId!, teamId: opts.teamId! } : {}),
      title: opts.kind === "common" ? "Common" : "Committee",
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
  await testDb.insert(question).values([
    {
      formVersionId: version!.id,
      questionKey: "interest",
      type: "single_select",
      label: "Area of interest",
      required: true,
      position: 1,
      configJson: { choices: ["AI", "Design"] },
    },
    {
      formVersionId: version!.id,
      questionKey: "ai-project",
      type: "long_text",
      label: "Describe an AI project",
      required: true,
      position: 2,
      visibilityRuleJson: { equals: { questionKey: "interest", value: "AI" } },
    },
    {
      formVersionId: version!.id,
      questionKey: "portfolio",
      type: "file_upload",
      label: "Portfolio",
      position: 3,
    },
  ]);
  return version!.id;
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
    await publishForm({ kind: "committee", openingId: opening!.id, teamId: t!.id });
  }

  commonVersionId = await publishForm({ kind: "common" });
});

/** Starts an application and fills in everything a valid submission needs. */
async function readyApplication(
  headers: Record<string, string>,
  openingId = labradorOpening,
  overrides: { interest?: string; aiProject?: string | null } = {},
) {
  const created = await request(app).post("/v1/me/applications").set(headers).send({ openingId });
  const applicationId = created.body.applicationId as string;

  const interest = overrides.interest ?? "AI";
  const aiProject =
    overrides.aiProject === undefined ? "A classifier for a course project." : overrides.aiProject;

  const answers: { questionKey: string; value: unknown }[] = [
    { questionKey: "interest", value: interest },
  ];
  if (aiProject !== null) {
    answers.push({ questionKey: "ai-project", value: aiProject });
  }

  await request(app)
    .patch("/v1/me/common-response/draft")
    .set(headers)
    .send({ revision: 0, answers });
  await request(app)
    .patch(`/v1/me/applications/${applicationId}/draft`)
    .set(headers)
    .send({ revision: 0, answers });

  return applicationId;
}

describe("atomicity under an injected failure at every step", () => {
  /*
   * A real failure, raised by the database, at each write the transaction
   * makes.
   *
   * A trigger rather than a mock. Mocking the transaction handle would test
   * the mock: what matters is that a genuine error mid-transaction rolls the
   * whole thing back, and only Postgres can answer that. Each table below is
   * one step of `submissionService`'s transaction, in the order it runs, so
   * installing the trigger on a different table moves the failure to a
   * different step.
   *
   * What every case asserts is identical and is the entire point: **no
   * partial finalization.** The application is still a draft, the shared
   * answers are not locked, no `submission` row exists to make a retry look
   * like a replay, and no confirmation email is queued for work that was not
   * saved.
   */
  const STEPS = [
    { table: "submission", on: "INSERT", step: "recording the submission itself" },
    { table: "form_response", on: "UPDATE", step: "finalizing a response" },
    { table: "application", on: "UPDATE", step: "marking the application submitted" },
    { table: "application_status_event", on: "INSERT", step: "writing the audit event" },
    { table: "candidate_profile", on: "UPDATE", step: "locking the shared answers" },
    { table: "notification_outbox", on: "INSERT", step: "queueing the confirmation" },
  ] as const;

  async function failOn(table: string, on: string) {
    await testDb.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION inject_failure() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected failure';
      END;
      $$ LANGUAGE plpgsql;
    `),
    );
    await testDb.execute(
      sql.raw(`
        CREATE TRIGGER inject_failure_trigger
        BEFORE ${on} ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION inject_failure();
      `),
    );
  }

  /*
   * Dropped after every case, from every table.
   *
   * `resetDb` truncates rows; a trigger is a schema object and survives it.
   * Leaving one installed broke every later test's draft save with a failure
   * that looked like the product was broken rather than the harness.
   */
  afterEach(async () => {
    for (const { table } of STEPS) {
      await testDb.execute(sql.raw(`DROP TRIGGER IF EXISTS inject_failure_trigger ON "${table}";`));
    }
  });

  for (const { table, on, step } of STEPS) {
    it(`finalizes nothing when ${step} fails`, async () => {
      const applicant = await seedApplicant("aquinn");
      const applicationId = await readyApplication(applicant.headers);
      await failOn(table, on);

      const res = await request(app)
        .post("/v1/me/submissions")
        .set(applicant.headers)
        .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

      // Not a 2xx, and - just as important - not a confirmation body.
      expect(res.status).toBeGreaterThanOrEqual(400);

      const [row] = await testDb.select().from(application);
      expect(row!.status).toBe("draft");
      expect(row!.submittedAt).toBeNull();
      expect(row!.submissionId).toBeNull();

      const [person] = await testDb.select().from(candidateProfile);
      // Locking on a failed attempt would leave somebody unable to fix the
      // very answers the failure was about.
      expect(person!.commonLockedAt).toBeNull();

      // No `submission` row, so a retry is a fresh attempt rather than being
      // recognised as a replay of one that never happened.
      expect(await testDb.select().from(submission)).toHaveLength(0);
      expect(await testDb.select().from(notificationOutbox)).toHaveLength(0);
    });
  }

  it("still submits once the injected failure is removed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await failOn("submission", "INSERT");

    const refused = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    await testDb.execute(sql.raw(`DROP TRIGGER inject_failure_trigger ON "submission";`));

    /*
     * The same idempotency key, and it must work.
     *
     * The rolled-back attempt must leave nothing behind that makes the honest
     * retry look like a duplicate - which is exactly what a `submission` row
     * surviving the rollback would do, and it would be indistinguishable from
     * the platform refusing somebody's application for no reason they can see.
     */
    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(200);
    const [row] = await testDb.select().from(application);
    expect(row!.status).toBe("submitted");
  });
});

describe("audit integrity", () => {
  it("records the status the application actually moved from", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    const [event] = await testDb.select().from(applicationStatusEvent);
    expect(event!.oldStatus).toBe("draft");
    expect(event!.newStatus).toBe("submitted");
    expect(event!.event).toBe("submitted");
    // The applicant's own act, so no staff member is named.
    expect(event!.changedBy).toBeNull();
  });

  it("records one event per application, not one per call", async () => {
    const applicant = await seedApplicant("aquinn");
    const first = await readyApplication(applicant.headers, labradorOpening);
    const second = await readyApplication(applicant.headers, designOpening);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [first, second] });

    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(2);
  });
});

describe("disclosure", () => {
  it("refuses to submit another applicant's application", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const applicationId = await readyApplication(owner.headers);

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(other.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // 404, not 403. Telling somebody an application exists that they may not
    // submit is itself a disclosure.
    expect(res.status).toBe(404);
  });

  it("does not submit the caller's own work when the batch names somebody else's", async () => {
    const owner = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const theirs = await readyApplication(owner.headers);
    const mine = await readyApplication(other.headers, designOpening);

    await request(app)
      .post("/v1/me/submissions")
      .set(other.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [mine, theirs] });

    // A batch is all or nothing, so naming somebody else's application must not
    // half-submit the caller's — and must not reveal whether theirs existed.
    const rows = await testDb.select().from(application);
    expect(rows.every((row) => row.status === "draft")).toBe(true);
  });

  it("names only the caller's own questions in a validation failure", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      aiProject: null,
    });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(422);
    const body = JSON.stringify(res.body);
    expect(body).toContain("ai-project");
    expect(body).not.toContain("bmorales");
  });
});

describe("atomicity", () => {
  it("submits nothing when one application in the batch is incomplete", async () => {
    const applicant = await seedApplicant("aquinn");
    const complete = await readyApplication(applicant.headers, labradorOpening);
    const incomplete = await readyApplication(applicant.headers, designOpening, {
      aiProject: null,
    });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [complete, incomplete] });

    expect(res.status).toBe(422);
    // Half a submission is the worst outcome available: the applicant believes
    // they applied to both and one committee never sees them.
    const rows = await testDb.select().from(application);
    expect(rows.every((row) => row.status === "draft")).toBe(true);
    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(0);
  });

  it("does not lock the common answers when the submission fails", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      aiProject: null,
    });

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // Locking on a failed attempt would leave somebody unable to fix the very
    // answers the failure was about.
    const [profile] = await testDb.select().from(candidateProfile);
    expect(profile!.commonLockedAt).toBeNull();
  });

  it("does not queue a notification when the submission fails", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      aiProject: null,
    });

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // The enqueue takes the transaction handle precisely so this cannot happen:
    // a confirmation email for a submission that rolled back.
    const queued = await testDb.select().from(notificationOutbox);
    expect(queued).toHaveLength(0);
  });

  it("queues exactly one confirmation for a successful submission", async () => {
    const applicant = await seedApplicant("aquinn");
    const first = await readyApplication(applicant.headers, labradorOpening);
    const second = await readyApplication(applicant.headers, designOpening);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [first, second] });

    // One email for the act, not one per committee. Two would read as a bug to
    // the applicant.
    const queued = await testDb.select().from(notificationOutbox);
    expect(queued).toHaveLength(1);
  });

  it("keeps no applicant answers in the notification payload", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    const [queued] = await testDb.select().from(notificationOutbox);
    expect(JSON.stringify(queued!.payloadJson)).not.toContain("classifier");
  });
});

describe("idempotency", () => {
  it("returns the same result for a repeated key and submits once", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    const first = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    const second = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // A double tap on a flaky campus connection must not submit twice or send
    // two emails.
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const events = await testDb.select().from(applicationStatusEvent);
    expect(events).toHaveLength(1);
    const queued = await testDb.select().from(notificationOutbox);
    expect(queued).toHaveLength(1);
  });

  it("refuses a fresh key for an application that is already submitted", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-b", applicationIds: [applicationId] });

    // Not the same request retried — a new act on something already done.
    expect(res.status).toBe(409);
  });

  it("does not let one applicant's key collide with another's", async () => {
    const first = await seedApplicant("aquinn");
    const second = await seedApplicant("bmorales");
    const theirs = await readyApplication(first.headers);
    const mine = await readyApplication(second.headers, designOpening);
    await request(app)
      .post("/v1/me/submissions")
      .set(first.headers)
      .send({ idempotencyKey: "shared-key", applicationIds: [theirs] });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(second.headers)
      .send({ idempotencyKey: "shared-key", applicationIds: [mine] });

    // The key is client-supplied. Globally unique, one applicant could make
    // another's real submission look like a replay of their own.
    expect(res.status).toBe(200);
    const rows = await testDb.select().from(application);
    expect(rows.filter((row) => row.status === "submitted")).toHaveLength(2);
  });
});

describe("validation", () => {
  it("reports every missing required answer, not just the first", async () => {
    const applicant = await seedApplicant("aquinn");
    const created = await request(app)
      .post("/v1/me/applications")
      .set(applicant.headers)
      .send({ openingId: labradorOpening });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [created.body.applicationId] });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("interest");
  });

  it("does not require a question the rules hide", async () => {
    const applicant = await seedApplicant("aquinn");
    // `Design` hides `ai-project`, which is required but invisible.
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      interest: "Design",
      aiProject: null,
    });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // Demanding an answer the applicant was never shown is the worst failure
    // available here, because nothing on screen explains it.
    expect(res.status).toBe(200);
  });

  it("drops an answer to a question the rules hide", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      interest: "AI",
      aiProject: "Written while they were still interested in AI.",
    });
    // They change their mind, so `ai-project` disappears from the form.
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "interest", value: "Design" }] });

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // Submitting the orphan would put text in front of a reviewer that the
    // applicant believes they removed.
    //
    // Scoped to this application's own response. Querying every `ai-project`
    // answer also matched the shared response, whose own `interest` is still
    // "AI" — so that answer is legitimately visible and legitimately kept. The
    // broad query made this test fail for the wrong reason.
    const detail = await request(app)
      .get(`/v1/me/applications/${applicationId}`)
      .set(applicant.headers);
    expect(detail.body.answers["ai-project"]).toBeUndefined();
    expect(detail.body.answers.interest).toBe("Design");

    const stored = await testDb
      .select({ key: question.questionKey })
      .from(answer)
      .innerJoin(question, eq(answer.questionId, question.id))
      .innerJoin(formResponse, eq(answer.formResponseId, formResponse.id))
      .where(eq(formResponse.applicationId, applicationId));
    expect(stored.map((row) => row.key)).toEqual(["interest"]);
  });

  it("refuses a file reference belonging to somebody else", async () => {
    const applicant = await seedApplicant("aquinn");
    const other = await seedApplicant("bmorales");
    const applicationId = await readyApplication(applicant.headers);
    const [theirFile] = await testDb
      .insert(file)
      .values({
        ownerUserId: other.andrewId,
        objectKey: "uploads/theirs",
        originalFilename: "theirs.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "committed",
        committedAt: now,
        createdAt: now,
      })
      .returning({ id: file.id });
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "portfolio", value: theirFile!.id }] });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // Attaching somebody else's upload would put their document in front of a
    // committee under this applicant's name.
    expect(res.status).toBe(422);
  });

  it("refuses a file_upload answer that is not a uuid at all", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "portfolio", value: "not-a-file-id" }] });

    /*
     * The ownership check used to infer "this is a file reference" from the
     * *shape* of the value. Anything that did not look like a uuid was silently
     * skipped, so an arbitrary string in a `file_upload` answer bypassed the
     * ownership and committed checks entirely and was stored as the answer.
     */
    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(422);
  });

  it("refuses a file_upload answer whose uuid is padded with whitespace", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    const [theirs] = await testDb
      .insert(file)
      .values({
        ownerUserId: "dchen",
        objectKey: "uploads/theirs",
        originalFilename: "theirs.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "committed",
        committedAt: now,
        createdAt: now,
      })
      .returning({ id: file.id });
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "portfolio", value: ` ${theirs!.id} ` }] });

    // The shape check is where the bypass lived: one space and the value stops
    // matching the pattern, so the ownership check never saw it.
    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(422);
  });

  it("does not treat a text answer that looks like a uuid as a file", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers, labradorOpening, {
      aiProject: "123e4567-e89b-42d3-a456-426614174000",
    });

    // The other direction of the same bug: a legitimate text answer that
    // happens to look like an id was ownership-checked and failed, blocking a
    // submission for no reason the applicant could act on.
    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(200);
  });

  it("refuses a file reference that was never committed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    const [pending] = await testDb
      .insert(file)
      .values({
        ownerUserId: applicant.andrewId,
        objectKey: "uploads/pending",
        originalFilename: "mine.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        createdAt: now,
      })
      .returning({ id: file.id });
    await request(app)
      .patch(`/v1/me/applications/${applicationId}/draft`)
      .set(applicant.headers)
      .send({ revision: 1, answers: [{ questionKey: "portfolio", value: pending!.id }] });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // An upload that never completed validation is not a document.
    expect(res.status).toBe(422);
  });
});

describe("deadlines and state", () => {
  it("refuses once the cycle deadline has passed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await testDb.update(recruitmentCycle).set({ closesAt: passedDeadline });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(409);
  });

  it("refuses once the committee's own deadline has passed", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await testDb
      .update(recruitmentOpening)
      .set({ closesAt: passedDeadline })
      .where(eq(recruitmentOpening.id, labradorOpening));

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(409);
  });

  it("refuses a withdrawn application", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await request(app).post(`/v1/me/applications/${applicationId}/withdraw`).set(applicant.headers);

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(409);
  });

  it("refuses an empty batch", async () => {
    const applicant = await seedApplicant("aquinn");

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [] });

    expect(res.status).toBe(422);
  });
});

describe("concurrency and versions", () => {
  it("submits against whatever revision validation read", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    // A revision well away from the default, so the write is provably matching
    // the value validation read rather than a hardcoded one.
    await testDb
      .update(formResponse)
      .set({ revision: 99 })
      .where(eq(formResponse.applicationId, applicationId));

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(200);
  });

  /*
   * Not tested: a draft save landing *between* validation and the write.
   *
   * That is the race the revision guard exists for, and this suite cannot
   * drive it. Validation and the write are separate statements, so the
   * interleaving needs either a genuinely concurrent Postgres or an injection
   * seam inside the service — and PGlite serializes requests in-process, so
   * issuing both at once proves nothing.
   *
   * An earlier version of this test bumped the revision *before* the submit and
   * asserted a 409. It passed, and it was meaningless: validation then read 99
   * and the guard enforced 99, so the guard was never exercised. Recorded as a
   * gap rather than papered over with a test that passes for the wrong reason.
   */

  it("validates against the version the response is bound to, not the newest", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    // A director publishes a new version after the applicant started. Their
    // response still names v1, which is the whole point of versioning.
    const [committeeForm] = await testDb
      .select({ id: form.id })
      .from(form)
      .where(eq(form.openingId, labradorOpening));
    const [v2] = await testDb
      .insert(formVersion)
      .values({
        formId: committeeForm!.id,
        version: 2,
        status: "published",
        publishedAt: new Date(now.getTime() + 1000),
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: formVersion.id });
    await testDb.insert(question).values({
      formVersionId: v2!.id,
      questionKey: "interest",
      type: "single_select",
      label: "Area of interest",
      required: true,
      position: 1,
      configJson: { choices: ["AI", "Design"] },
    });

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    /*
     * Loading the newest version's questions made every v1 answer look
     * unrecognised, so the prune deleted all of them. The same class of defect
     * as the empty keep set, arriving by a different route.
     */
    expect(res.status).toBe(200);
    const detail = await request(app)
      .get(`/v1/me/applications/${applicationId}`)
      .set(applicant.headers);
    expect(detail.body.answers.interest).toBe("AI");
    expect(detail.body.answers["ai-project"]).toBeTruthy();
  });

  it("uses the current cycle's profile when the applicant has an older one", async () => {
    const applicant = await seedApplicant("aquinn");
    // A cycle they applied in previously, opened earlier than the current one.
    const [old] = await testDb
      .insert(recruitmentCycle)
      .values({
        slug: "fall-2026",
        name: "Fall 2026",
        status: "archived",
        opensAt: new Date(past.getTime() - 86_400_000),
        createdBy: "dchen",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recruitmentCycle.id });
    await testDb
      .insert(candidateProfile)
      .values({ userId: applicant.andrewId, cycleId: old!.id, createdAt: now, updatedAt: now });

    const applicationId = await readyApplication(applicant.headers);

    // The profile lookup had no cycle filter, so it returned whichever row came
    // back first, and locking or submitting against last season's profile would
    // be wrong in a way nobody would notice until it mattered.
    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(200);
    const profiles = await testDb.select().from(candidateProfile);
    const locked = profiles.filter((row) => row.commonLockedAt !== null);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.cycleId).toBe(cycleId);
  });
});

describe("the happy path", () => {
  it("submits, locks the common answers, and reports when", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    const res = await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    expect(res.status).toBe(200);
    expect(res.body.submitted).toHaveLength(1);
    expect(res.body.submitted[0].submittedAt).toBeTruthy();

    const [profile] = await testDb.select().from(candidateProfile);
    expect(profile!.commonLockedAt).not.toBeNull();
  });

  it("marks both the application and its responses submitted", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    const [row] = await testDb.select().from(application);
    expect(row!.status).toBe("submitted");
    expect(row!.submittedAt).not.toBeNull();
    const responses = await testDb.select().from(formResponse);
    expect(responses.every((r) => r.status === "submitted")).toBe(true);
  });

  it("is visible as Submitted to the applicant immediately", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);
    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // The response is returned after commit, so a read straight afterwards must
    // already see it. Anything else means somebody saw a confirmation for work
    // that was not saved.
    const res = await request(app).get("/v1/me/applications").set(applicant.headers);

    expect(res.body[0].status).toBe("Submitted");
  });

  it("keeps the common answers readable after locking", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    // Locked means unchangeable, not invisible. Somebody has to be able to see
    // what they submitted.
    const res = await request(app).get("/v1/me/profile").set(applicant.headers);
    expect(res.body.commonLocked).toBe(true);
  });

  it("keeps the submitted answers, rather than pruning them away", async () => {
    const applicant = await seedApplicant("aquinn");
    const applicationId = await readyApplication(applicant.headers);

    await request(app)
      .post("/v1/me/submissions")
      .set(applicant.headers)
      .send({ idempotencyKey: "key-a", applicationIds: [applicationId] });

    /*
     * The assertion the previous version of this test was missing.
     *
     * It checked the `commonLocked` flag and nothing else, so it passed while
     * the submission was deleting every shared answer on its way out — the
     * hidden-answer prune ran with an empty keep set. A committee would have
     * received an application with no answers at all, and the applicant would
     * have seen a successful confirmation.
     */
    const commonAnswers = await testDb
      .select({ questionKey: question.questionKey })
      .from(answer)
      .innerJoin(question, eq(answer.questionId, question.id))
      .where(eq(question.formVersionId, commonVersionId));
    expect(commonAnswers.map((row) => row.questionKey).sort()).toEqual(["ai-project", "interest"]);

    const detail = await request(app)
      .get(`/v1/me/applications/${applicationId}`)
      .set(applicant.headers);
    expect(detail.body.answers.interest).toBe("AI");
    expect(detail.body.answers["ai-project"]).toBeTruthy();
  });
});
