/**
 * Constraints on the review, decision, file, notification and audit tables.
 *
 * Two carry specific history. The `review_assignment` index is partial on
 * purpose — v1's covered cancelled rows, so reassigning a previously-cancelled
 * reviewer returned 409 and left 255 rows of debt. And `review_score` uses the
 * same composite-foreign-key technique as `answer`, so a score cannot reference
 * a criterion from a different rubric.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  application,
  applicationStatusEvent,
  auditEvent,
  candidateProfile,
  file,
  notificationOutbox,
  recruitmentCycle,
  recruitmentOpening,
  review,
  reviewAssignment,
  reviewScore,
  rubric,
  rubricCriterion,
  team,
  user,
} from "../src/schema/index.ts";
import { db, expectRejection, resetDb } from "./harness.ts";

const now = new Date();

let openingId: string;
let applicationId: string;

beforeEach(async () => {
  await resetDb();
  for (const id of ["rjones", "reviewer-a", "reviewer-b"]) {
    await db.insert(user).values({
      id,
      name: id,
      email: `${id}@andrew.cmu.edu`,
      createdAt: now,
      updatedAt: now,
    });
  }
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
  const [t] = await db
    .insert(team)
    .values({ slug: "labrador", name: "Labrador", createdAt: now, updatedAt: now })
    .returning({ id: team.id });
  const [opening] = await db
    .insert(recruitmentOpening)
    .values({ cycleId: cycle!.id, teamId: t!.id, createdAt: now, updatedAt: now })
    .returning({ id: recruitmentOpening.id });
  openingId = opening!.id;
  const [profile] = await db
    .insert(candidateProfile)
    .values({ userId: "rjones", cycleId: cycle!.id, createdAt: now, updatedAt: now })
    .returning({ id: candidateProfile.id });
  const [app] = await db
    .insert(application)
    .values({
      candidateProfileId: profile!.id,
      openingId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: application.id });
  applicationId = app!.id;
});

async function insertRubric(version = 1, status: "draft" | "active" | "locked" = "active") {
  const [row] = await db
    .insert(rubric)
    .values({ openingId, version, status, createdBy: "rjones", createdAt: now, updatedAt: now })
    .returning({ id: rubric.id });
  return row!.id;
}

async function insertCriterion(rubricId: string, name = "Motivation", position = 1) {
  const [row] = await db
    .insert(rubricCriterion)
    .values({ rubricId, name, minimumScore: 1, maximumScore: 5, position })
    .returning({ id: rubricCriterion.id });
  return row!.id;
}

async function insertAssignment(
  reviewerId: string,
  status: "assigned" | "cancelled" | "submitted" = "assigned",
) {
  const [row] = await db
    .insert(reviewAssignment)
    .values({ applicationId, reviewerId, assignedBy: "rjones", status, assignedAt: now })
    .returning({ id: reviewAssignment.id });
  return row!.id;
}

describe("rubric", () => {
  it("rejects a duplicate version on one opening", async () => {
    await insertRubric(1);

    await expectRejection(() => insertRubric(1, "draft"), "23505");
  });

  it("rejects a second active rubric on one opening", async () => {
    await insertRubric(1, "active");

    // Which rubric a review is scored against must never be ambiguous.
    await expectRejection(() => insertRubric(2, "active"), "23505");
  });

  it("allows a draft alongside an active one, so criteria can be revised", async () => {
    await insertRubric(1, "active");
    await insertRubric(2, "draft");

    const rows = await db.select().from(rubric);
    expect(rows).toHaveLength(2);
  });
});

describe("rubric_criterion", () => {
  it("rejects a maximum at or below the minimum", async () => {
    const rubricId = await insertRubric();

    await expectRejection(
      () =>
        db.insert(rubricCriterion).values({
          rubricId,
          name: "Motivation",
          minimumScore: 5,
          maximumScore: 5,
          position: 1,
        }),
      "23514",
    );
  });

  it("rejects two criteria with the same name in one rubric", async () => {
    const rubricId = await insertRubric();
    await insertCriterion(rubricId, "Motivation", 1);

    await expectRejection(() => insertCriterion(rubricId, "Motivation", 2), "23505");
  });
});

describe("review_assignment", () => {
  it("rejects assigning the same reviewer twice to one application", async () => {
    await insertAssignment("reviewer-a");

    await expectRejection(() => insertAssignment("reviewer-a"), "23505");
  });

  it("allows reassigning a reviewer whose earlier assignment was cancelled", async () => {
    await insertAssignment("reviewer-a", "cancelled");

    // The index is partial on `status <> 'cancelled'` precisely for this. v1's
    // covered cancelled rows, so re-adding a removed reviewer returned 409 and
    // left 255 rows that could not be reassigned.
    await insertAssignment("reviewer-a", "assigned");

    const rows = await db.select().from(reviewAssignment);
    expect(rows).toHaveLength(2);
  });

  it("allows two different reviewers on one application", async () => {
    await insertAssignment("reviewer-a");
    await insertAssignment("reviewer-b");

    const rows = await db.select().from(reviewAssignment);
    expect(rows).toHaveLength(2);
  });
});

describe("review", () => {
  it("rejects two reviews for one assignment", async () => {
    const rubricId = await insertRubric();
    const assignmentId = await insertAssignment("reviewer-a");
    await db.insert(review).values({ assignmentId, rubricId, createdAt: now, updatedAt: now });

    await expectRejection(
      () => db.insert(review).values({ assignmentId, rubricId, createdAt: now, updatedAt: now }),
      "23505",
    );
  });

  it("rejects a submitted review with no submitted timestamp", async () => {
    const rubricId = await insertRubric();
    const assignmentId = await insertAssignment("reviewer-a");

    // `submittedAt` is what unblinds peer reviews for this reviewer, so a
    // submitted review without one would be invisible to the rule that matters.
    await expectRejection(
      () =>
        db.insert(review).values({
          assignmentId,
          rubricId,
          status: "submitted",
          createdAt: now,
          updatedAt: now,
        }),
      "23514",
    );
  });
});

describe("review_score", () => {
  async function insertReview(rubricId: string, reviewerId = "reviewer-a") {
    const assignmentId = await insertAssignment(reviewerId);
    const [row] = await db
      .insert(review)
      .values({ assignmentId, rubricId, createdAt: now, updatedAt: now })
      .returning({ id: review.id });
    return row!.id;
  }

  it("accepts a score against a criterion of its own rubric", async () => {
    const rubricId = await insertRubric();
    const criterionId = await insertCriterion(rubricId);
    const reviewId = await insertReview(rubricId);

    await db.insert(reviewScore).values({ reviewId, rubricId, criterionId, score: 4 });

    const rows = await db.select().from(reviewScore);
    expect(rows).toHaveLength(1);
  });

  it("rejects a score against a criterion from a different rubric", async () => {
    const first = await insertRubric(1, "active");
    const second = await insertRubric(2, "draft");
    const otherCriterion = await insertCriterion(second);
    const reviewId = await insertReview(first);

    // Same technique as `answer`: the database refuses a score that reaches
    // across rubric versions, rather than a service having to remember to.
    await expectRejection(
      () =>
        db.insert(reviewScore).values({
          reviewId,
          rubricId: first,
          criterionId: otherCriterion,
          score: 4,
        }),
      "23503",
    );
  });

  it("rejects two scores for the same criterion in one review", async () => {
    const rubricId = await insertRubric();
    const criterionId = await insertCriterion(rubricId);
    const reviewId = await insertReview(rubricId);
    await db.insert(reviewScore).values({ reviewId, rubricId, criterionId, score: 4 });

    await expectRejection(
      () => db.insert(reviewScore).values({ reviewId, rubricId, criterionId, score: 2 }),
      "23505",
    );
  });
});

describe("application_status_event", () => {
  it("records a transition with its actor", async () => {
    await db.insert(applicationStatusEvent).values({
      applicationId,
      oldStatus: "draft",
      newStatus: "submitted",
      event: "submitted",
      changedBy: "rjones",
      createdAt: now,
    });

    const rows = await db.select().from(applicationStatusEvent);
    expect(rows).toHaveLength(1);
  });

  it("allows an applicant-initiated event with no actor", async () => {
    // A withdrawal is the applicant's own act, and attributing it to a staff
    // member would be a false record.
    await db.insert(applicationStatusEvent).values({
      applicationId,
      oldStatus: "submitted",
      newStatus: "withdrawn",
      event: "withdrawn",
      createdAt: now,
    });

    const [row] = await db.select().from(applicationStatusEvent);
    expect(row!.changedBy).toBeNull();
  });

  it("records offer, acceptance and confirmation as three separate events", async () => {
    for (const event of ["offered", "accepted", "confirmed"] as const) {
      await db.insert(applicationStatusEvent).values({
        applicationId,
        newStatus: "decided",
        event,
        changedBy: "rjones",
        createdAt: now,
      });
    }

    const rows = await db.select().from(applicationStatusEvent);
    expect(rows.map((r) => r.event).sort()).toEqual(["accepted", "confirmed", "offered"]);
  });
});

describe("file", () => {
  it("rejects a duplicate object key", async () => {
    const values = {
      ownerUserId: "rjones",
      objectKey: "uploads/abc123",
      originalFilename: "portfolio.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      createdAt: now,
    };
    await db.insert(file).values(values);

    await expectRejection(() => db.insert(file).values(values), "23505");
  });

  it("rejects a non-positive size", async () => {
    await expectRejection(
      () =>
        db.insert(file).values({
          ownerUserId: "rjones",
          objectKey: "uploads/empty",
          originalFilename: "empty.pdf",
          mimeType: "application/pdf",
          sizeBytes: 0,
          createdAt: now,
        }),
      "23514",
    );
  });

  it("starts pending, so an uncommitted upload can never be submitted", async () => {
    await db.insert(file).values({
      ownerUserId: "rjones",
      objectKey: "uploads/abc123",
      originalFilename: "portfolio.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      createdAt: now,
    });

    const [row] = await db.select().from(file);
    expect(row!.status).toBe("pending");
  });
});

describe("notification_outbox", () => {
  it("starts pending with no attempts, available immediately", async () => {
    await db.insert(notificationOutbox).values({
      template: "submission-confirmation",
      recipientEmail: "rjones@andrew.cmu.edu",
      payloadJson: { applicationCount: 2 },
      availableAt: now,
      createdAt: now,
    });

    const [row] = await db.select().from(notificationOutbox);
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(0);
  });

  it("rejects a negative attempt count", async () => {
    await expectRejection(
      () =>
        db.insert(notificationOutbox).values({
          template: "submission-confirmation",
          recipientEmail: "rjones@andrew.cmu.edu",
          attempts: -1,
          availableAt: now,
          createdAt: now,
        }),
      "23514",
    );
  });
});

describe("audit_event", () => {
  it("records an action with its actor and subject", async () => {
    await db.insert(auditEvent).values({
      actorUserId: "rjones",
      action: "form_version.published",
      subjectType: "form_version",
      subjectId: "00000000-0000-0000-0000-000000000000",
      createdAt: now,
    });

    const rows = await db.select().from(auditEvent);
    expect(rows).toHaveLength(1);
  });

  it("allows a system action with no actor", async () => {
    await db.insert(auditEvent).values({
      action: "cycle.auto_closed",
      subjectType: "recruitment_cycle",
      subjectId: "00000000-0000-0000-0000-000000000000",
      createdAt: now,
    });

    const [row] = await db.select().from(auditEvent);
    expect(row!.actorUserId).toBeNull();
  });
});
