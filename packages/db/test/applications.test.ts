/**
 * Constraints on the application tables.
 *
 * Two of these are the places a cross-committee leak could enter through the
 * data layer rather than through a service, so they are enforced by composite
 * foreign keys: an answer's question must belong to the response's own form
 * version, and a response belongs to exactly one owner.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  answer,
  application,
  candidateProfile,
  form,
  formResponse,
  formVersion,
  question,
  submission,
  recruitmentCycle,
  recruitmentOpening,
  team,
  user,
} from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

const now = new Date();

let cycleId: string;
let openingId: string;
let profileId: string;

beforeEach(async () => {
  await resetDb();
  await db.insert(user).values({
    id: "rjones",
    name: "Robin Jones",
    email: "rjones@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
  const [cycle] = await db
    .insert(recruitmentCycle)
    .values({
      slug: "spring-2027",
      name: "Spring 2027",
      createdBy: "rjones",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;
  const [t] = await db
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  const [opening] = await db
    .insert(recruitmentOpening)
    .values({ cycleId, teamId: t!.id, createdAt: now, updatedAt: now })
    .returning({ id: recruitmentOpening.id });
  openingId = opening!.id;
  const [profile] = await db
    .insert(candidateProfile)
    .values({ userId: "rjones", cycleId, createdAt: now, updatedAt: now })
    .returning({ id: candidateProfile.id });
  profileId = profile!.id;
});

async function insertApplication(overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(application)
    .values({
      candidateProfileId: profileId,
      openingId,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning({ id: application.id });
  return row!.id;
}

/** A published common form with one question, returned as ids. */
async function insertCommonFormVersion(version = 1) {
  const existing = await db.select({ id: form.id }).from(form);
  const formId =
    existing[0]?.id ??
    (
      await db
        .insert(form)
        .values({ cycleId, kind: "common", title: "Common", createdAt: now, updatedAt: now })
        .returning({ id: form.id })
    )[0]!.id;
  const [v] = await db
    .insert(formVersion)
    .values({
      formId,
      version,
      status: "published",
      publishedAt: now,
      createdBy: "rjones",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: formVersion.id });
  const [q] = await db
    .insert(question)
    .values({
      formVersionId: v!.id,
      questionKey: "major",
      type: "short_text",
      label: "What is your major?",
      position: 1,
    })
    .returning({ id: question.id });
  return { formVersionId: v!.id, questionId: q!.id };
}

describe("candidate_profile", () => {
  it("rejects a second profile for the same person in one cycle", async () => {
    await expectRejection(
      () =>
        db
          .insert(candidateProfile)
          .values({ userId: "rjones", cycleId, createdAt: now, updatedAt: now }),
      "23505",
    );
  });
});

describe("application", () => {
  it("rejects a duplicate application to the same opening", async () => {
    await insertApplication();

    await expectRejection(() => insertApplication(), "23505");
  });

  it("allows many applications for one profile", async () => {
    const [t2] = await db
      .insert(team)
      .values({ slug: "design", name: "Design", createdAt: now, updatedAt: now })
      .returning({ id: team.id });
    const [other] = await db
      .insert(recruitmentOpening)
      .values({ cycleId, teamId: t2!.id, createdAt: now, updatedAt: now })
      .returning({ id: recruitmentOpening.id });

    await insertApplication();
    await insertApplication({ openingId: other!.id });

    const rows = await db.select().from(application);
    expect(rows).toHaveLength(2);
  });

  it("starts as a draft", async () => {
    await insertApplication();

    const [row] = await db.select().from(application);
    expect(row!.status).toBe("draft");
  });
});

describe("submission", () => {
  it("rejects a reused idempotency key for one applicant", async () => {
    const values = { candidateProfileId: profileId, idempotencyKey: "key-a", submittedAt: now };
    await db.insert(submission).values(values);

    // A double tap on a flaky connection must not submit twice.
    await expectRejection(() => db.insert(submission).values(values), "23505");
  });

  it("lets two applicants use the same key", async () => {
    await db.insert(user).values({
      id: "bmorales",
      name: "Blair",
      email: "bmorales@andrew.cmu.edu",
      createdAt: now,
      updatedAt: now,
    });
    const [otherProfile] = await db
      .insert(candidateProfile)
      .values({ userId: "bmorales", cycleId, createdAt: now, updatedAt: now })
      .returning({ id: candidateProfile.id });

    // The key is client-supplied. Globally unique, one applicant could burn
    // another's key and make their real submission look like a replay.
    await db
      .insert(submission)
      .values({ candidateProfileId: profileId, idempotencyKey: "shared", submittedAt: now });
    await db
      .insert(submission)
      .values({ candidateProfileId: otherProfile!.id, idempotencyKey: "shared", submittedAt: now });

    const rows = await db.select().from(submission);
    expect(rows).toHaveLength(2);
  });

  it("refuses to delete a submission an application still points at", async () => {
    const [row] = await db
      .insert(submission)
      .values({ candidateProfileId: profileId, idempotencyKey: "key-a", submittedAt: now })
      .returning({ id: submission.id });
    await insertApplication({ submissionId: row!.id, status: "submitted", submittedAt: now });

    // The row is the record of when somebody pressed Submit and what it
    // covered. Losing it would leave applications submitted by nothing.
    await expectRejection(() => db.delete(submission), "23001");
  });
});

describe("form_response", () => {
  it("rejects a response with no owner", async () => {
    const { formVersionId } = await insertCommonFormVersion();

    await expectRejection(
      () => db.insert(formResponse).values({ formVersionId, createdAt: now, updatedAt: now }),
      "23514",
    );
  });

  it("rejects a response with two owners", async () => {
    const { formVersionId } = await insertCommonFormVersion();
    const applicationId = await insertApplication();

    // A common response belongs to a profile and a committee response belongs to
    // an application. One that claimed both would be ambiguous to every service
    // that loads "the common answers".
    await expectRejection(
      () =>
        db.insert(formResponse).values({
          formVersionId,
          candidateProfileId: profileId,
          applicationId,
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });

  it("rejects two responses to one version from one profile", async () => {
    const { formVersionId } = await insertCommonFormVersion();
    await db.insert(formResponse).values({
      formVersionId,
      candidateProfileId: profileId,
      createdAt: now,
      updatedAt: now,
    });

    await expectRejection(
      () =>
        db.insert(formResponse).values({
          formVersionId,
          candidateProfileId: profileId,
          createdAt: now,
          updatedAt: now,
        }),
      "23505",
    );
  });

  it("starts at revision zero, so the first write can carry it", async () => {
    const { formVersionId } = await insertCommonFormVersion();

    await db.insert(formResponse).values({
      formVersionId,
      candidateProfileId: profileId,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(formResponse);
    expect(row!.revision).toBe(0);
  });
});

describe("answer", () => {
  async function insertResponse(formVersionId: string) {
    const [row] = await db
      .insert(formResponse)
      .values({
        formVersionId,
        candidateProfileId: profileId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: formResponse.id });
    return row!.id;
  }

  it("accepts an answer to a question in its own version", async () => {
    const { formVersionId, questionId } = await insertCommonFormVersion();
    const responseId = await insertResponse(formVersionId);

    await db.insert(answer).values({
      formResponseId: responseId,
      formVersionId,
      questionId,
      valueJsonb: "Computer Science",
      updatedAt: now,
    });

    const rows = await db.select().from(answer);
    expect(rows).toHaveLength(1);
  });

  it("rejects an answer to a question from a different form version", async () => {
    const first = await insertCommonFormVersion(1);
    const second = await insertCommonFormVersion(2);
    const responseId = await insertResponse(first.formVersionId);

    // This is the constraint that matters most in this file. Without it an
    // answer can point at a question belonging to a *different committee's*
    // form, which is a cross-tenant leak arriving through the data layer rather
    // than through any service anybody reviewed.
    await expectRejection(
      () =>
        db.insert(answer).values({
          formResponseId: responseId,
          formVersionId: first.formVersionId,
          questionId: second.questionId,
          valueJsonb: "Computer Science",
          updatedAt: now,
        }),
      "23503",
    );
  });

  it("rejects an answer whose declared version is not its response's", async () => {
    const first = await insertCommonFormVersion(1);
    const second = await insertCommonFormVersion(2);
    const responseId = await insertResponse(first.formVersionId);

    // The other half of the pair: lying about the version would let the first
    // check pass against the wrong question set.
    await expectRejection(
      () =>
        db.insert(answer).values({
          formResponseId: responseId,
          formVersionId: second.formVersionId,
          questionId: second.questionId,
          valueJsonb: "Computer Science",
          updatedAt: now,
        }),
      "23503",
    );
  });

  it("rejects two answers to the same question in one response", async () => {
    const { formVersionId, questionId } = await insertCommonFormVersion();
    const responseId = await insertResponse(formVersionId);
    await db.insert(answer).values({
      formResponseId: responseId,
      formVersionId,
      questionId,
      valueJsonb: "Computer Science",
      updatedAt: now,
    });

    await expectRejection(
      () =>
        db.insert(answer).values({
          formResponseId: responseId,
          formVersionId,
          questionId,
          valueJsonb: "Statistics",
          updatedAt: now,
        }),
      "23505",
    );
  });

  it("disappears with its response", async () => {
    const { formVersionId, questionId } = await insertCommonFormVersion();
    const responseId = await insertResponse(formVersionId);
    await db.insert(answer).values({
      formResponseId: responseId,
      formVersionId,
      questionId,
      valueJsonb: "Computer Science",
      updatedAt: now,
    });

    await db.delete(formResponse);

    const rows = await db.select().from(answer);
    expect(rows).toHaveLength(0);
  });
});
