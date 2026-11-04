/**
 * Constraints on the form tables.
 *
 * The rules here are what make an application historically accurate: a question
 * belongs to exactly one version of exactly one form, and a published version
 * is the thing a response points at forever. A director must not be able to
 * change what a question meant after somebody answered it.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  form,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
  team,
  user,
} from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

const now = new Date();

let cycleId: string;
let openingId: string;
let teamId: string;

beforeEach(async () => {
  await resetDb();
  await db.insert(user).values({
    id: "semathew",
    name: "Sam",
    email: "semathew@andrew.cmu.edu",
    createdAt: now,
    updatedAt: now,
  });
  const [cycle] = await db
    .insert(recruitmentCycle)
    .values({
      slug: "spring-2027",
      name: "Spring 2027",
      createdBy: "semathew",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recruitmentCycle.id });
  cycleId = cycle!.id;
  const [t] = await db
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  teamId = t!.id;
  const [opening] = await db
    .insert(recruitmentOpening)
    .values({ cycleId, teamId, createdAt: now, updatedAt: now })
    .returning({ id: recruitmentOpening.id });
  openingId = opening!.id;
});

async function insertCommonForm() {
  const [row] = await db
    .insert(form)
    .values({
      cycleId,
      kind: "common",
      title: "Common Application",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: form.id });
  return row!.id;
}

async function insertCommitteeForm() {
  const [row] = await db
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
  return row!.id;
}

async function insertVersion(formId: string, version: number, status: "draft" | "published") {
  const [row] = await db
    .insert(formVersion)
    .values({
      formId,
      version,
      status,
      createdBy: "semathew",
      ...(status === "published" ? { publishedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: formVersion.id });
  return row!.id;
}

describe("form", () => {
  it("rejects a common form that names a team", async () => {
    await expectRejection(
      () =>
        db.insert(form).values({
          cycleId,
          teamId,
          kind: "common",
          title: "Common",
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });

  it("rejects a committee form with no opening", async () => {
    await expectRejection(
      () =>
        db.insert(form).values({
          cycleId,
          teamId,
          kind: "committee",
          title: "Labrador",
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });

  it("rejects a second common form in one cycle", async () => {
    await insertCommonForm();

    await expectRejection(insertCommonForm, "23505");
  });

  it("rejects a second committee form on one opening", async () => {
    await insertCommitteeForm();

    await expectRejection(insertCommitteeForm, "23505");
  });

  it("allows a common form and a committee form in the same cycle", async () => {
    await insertCommonForm();
    await insertCommitteeForm();

    const rows = await db.select().from(form);
    expect(rows).toHaveLength(2);
  });
});

describe("form_version", () => {
  it("rejects a duplicate version number on one form", async () => {
    const formId = await insertCommonForm();
    await insertVersion(formId, 1, "published");

    await expectRejection(() => insertVersion(formId, 1, "draft"), "23505");
  });

  it("rejects a second draft on one form", async () => {
    const formId = await insertCommonForm();
    await insertVersion(formId, 1, "draft");

    // Editing a published version means creating a new draft, and there can only
    // ever be the one somebody is working on. Two would make "the draft"
    // ambiguous in every service that loads it.
    await expectRejection(() => insertVersion(formId, 2, "draft"), "23505");
  });

  it("allows many published versions alongside one draft", async () => {
    const formId = await insertCommonForm();
    await insertVersion(formId, 1, "published");
    await insertVersion(formId, 2, "published");
    await insertVersion(formId, 3, "draft");

    const rows = await db.select().from(formVersion);
    expect(rows).toHaveLength(3);
  });

  it("rejects a published version with no published timestamp", async () => {
    const formId = await insertCommonForm();

    await expectRejection(
      () =>
        db.insert(formVersion).values({
          formId,
          version: 1,
          status: "published",
          createdBy: "semathew",
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });
});

describe("question", () => {
  it("rejects a duplicate question key within one version", async () => {
    const formId = await insertCommonForm();
    const versionId = await insertVersion(formId, 1, "draft");
    await db.insert(question).values({
      formVersionId: versionId,
      questionKey: "major",
      type: "short_text",
      label: "What is your major?",
      position: 1,
    });

    await expectRejection(
      () =>
        db.insert(question).values({
          formVersionId: versionId,
          questionKey: "major",
          type: "short_text",
          label: "Major again",
          position: 2,
        }),
      "23505",
    );
  });

  it("allows the same question key in a different version", async () => {
    const formId = await insertCommonForm();
    const first = await insertVersion(formId, 1, "published");
    const second = await insertVersion(formId, 2, "draft");
    const values = {
      questionKey: "major",
      type: "short_text" as const,
      label: "What is your major?",
      position: 1,
    };

    // A stable logical key is the point: the same question carries across
    // versions, which is what lets a reader compare answers between them.
    await db.insert(question).values({ ...values, formVersionId: first });
    await db.insert(question).values({ ...values, formVersionId: second });

    const rows = await db.select().from(question);
    expect(rows).toHaveLength(2);
  });

  it("rejects two questions at the same position in one version", async () => {
    const formId = await insertCommonForm();
    const versionId = await insertVersion(formId, 1, "draft");
    await db.insert(question).values({
      formVersionId: versionId,
      questionKey: "major",
      type: "short_text",
      label: "Major",
      position: 1,
    });

    // Ordering has to be deterministic: conditional rules are evaluated in a
    // single pass in position order, so an ambiguous order is an ambiguous rule.
    await expectRejection(
      () =>
        db.insert(question).values({
          formVersionId: versionId,
          questionKey: "year",
          type: "number",
          label: "Graduation year",
          position: 1,
        }),
      "23505",
    );
  });

  it("disappears with its version", async () => {
    const formId = await insertCommonForm();
    const versionId = await insertVersion(formId, 1, "draft");
    await db.insert(question).values({
      formVersionId: versionId,
      questionKey: "major",
      type: "short_text",
      label: "Major",
      position: 1,
    });

    await db.delete(formVersion);

    const rows = await db.select().from(question);
    expect(rows).toHaveLength(0);
  });
});
