import type {
  AnswerMap,
  AnswerValue,
  QuestionConfig,
  QuestionDefinition,
  VisibilityRule,
} from "@recruit/common";
import { validateResponse } from "@recruit/common";
import {
  answer,
  application,
  applicationStatusEvent,
  candidateProfile,
  file,
  form,
  formResponse,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
  submission,
  team,
  user,
} from "@recruit/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { hasOpened } from "../lib/cycleVisibility.ts";
import { db } from "../lib/db.ts";
import type { Transaction } from "../lib/db.ts";
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from "../middlewares/errorHandler.ts";
import { enqueueNotification } from "./notificationService.ts";

export interface SubmittedApplication {
  applicationId: string;
  committeeName: string;
  submittedAt: string;
}

export interface SubmissionResult {
  submitted: SubmittedApplication[];
}

/** One application's problems, named by question so the client can link to them. */
interface ApplicationProblems {
  applicationId: string;
  committeeName: string;
  missing: string[];
  invalid: { questionKey: string; message: string }[];
}

function toDefinition(row: {
  questionKey: string;
  type: QuestionDefinition["type"];
  label: string;
  description: string | null;
  required: boolean;
  position: number;
  configJson: unknown;
  visibilityRuleJson: unknown;
}): QuestionDefinition {
  return {
    questionKey: row.questionKey,
    type: row.type,
    label: row.label,
    description: row.description,
    required: row.required,
    position: row.position,
    config: (row.configJson as QuestionConfig | null) ?? null,
    visibilityRule: (row.visibilityRuleJson as VisibilityRule | null) ?? null,
  };
}

/**
 * Finalizes one or more applications, as a single act.
 *
 * Implements `docs/design.md` section 9.2 in order, in one transaction. The
 * order is not arbitrary: everything that can refuse does so before anything is
 * written, so a refusal leaves no trace and a success leaves no half-state.
 *
 * **All or nothing across the batch.** Half a submission is the worst outcome
 * available here — the applicant believes they applied to both committees and
 * one of them never sees them, with nothing on either side to reveal it.
 */
export const submissionService = {
  submit: async (
    userId: string,
    idempotencyKey: string,
    applicationIds: string[],
  ): Promise<SubmissionResult> => {
    const now = new Date();

    if (applicationIds.length === 0) {
      throw new ValidationFailedError("Choose at least one application to submit.");
    }

    // Deduplicated, so naming the same application twice is not two submissions
    // of it, and the batch size matches what the applicant meant.
    const wanted = [...new Set(applicationIds)];

    const [profile] = await db
      .select({ id: candidateProfile.id, commonLockedAt: candidateProfile.commonLockedAt })
      .from(candidateProfile)
      .innerJoin(user, eq(candidateProfile.userId, user.id))
      .where(eq(candidateProfile.userId, userId));
    if (!profile) {
      throw new NotFoundError();
    }

    /*
     * A repeat of the same act, recognised before anything else happens.
     *
     * Scoped to this applicant's profile, so one person's key cannot be used to
     * probe or replay another's. Returns what the original submitted rather
     * than re-running it, which is what makes a double tap on a flaky
     * connection harmless.
     */
    const [existing] = await db
      .select({ id: submission.id, submittedAt: submission.submittedAt })
      .from(submission)
      .where(
        and(
          eq(submission.candidateProfileId, profile.id),
          eq(submission.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      const rows = await db
        .select({ id: application.id, committeeName: team.name })
        .from(application)
        .innerJoin(recruitmentOpening, eq(application.openingId, recruitmentOpening.id))
        .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
        .where(eq(application.submissionId, existing.id));
      return {
        submitted: rows.map((row) => ({
          applicationId: row.id,
          committeeName: row.committeeName,
          submittedAt: existing.submittedAt.toISOString(),
        })),
      };
    }

    /*
     * Every application in the batch, scoped to this profile in the query.
     *
     * If the count does not match, one of the ids is not the caller's — or does
     * not exist, which is indistinguishable on purpose. 404 for the whole
     * batch, so naming somebody else's application neither reveals it nor
     * half-submits the caller's own.
     */
    const targets = await db
      .select({
        id: application.id,
        status: application.status,
        withdrawnAt: application.withdrawnAt,
        openingId: application.openingId,
        committeeName: team.name,
        openingStatus: recruitmentOpening.status,
        openingOpensAt: recruitmentOpening.opensAt,
        openingClosesAt: recruitmentOpening.closesAt,
        cycleId: recruitmentCycle.id,
        cycleStatus: recruitmentCycle.status,
        cycleOpensAt: recruitmentCycle.opensAt,
        cycleClosesAt: recruitmentCycle.closesAt,
      })
      .from(application)
      .innerJoin(recruitmentOpening, eq(application.openingId, recruitmentOpening.id))
      .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
      .innerJoin(recruitmentCycle, eq(recruitmentOpening.cycleId, recruitmentCycle.id))
      .where(and(inArray(application.id, wanted), eq(application.candidateProfileId, profile.id)));

    if (targets.length !== wanted.length) {
      throw new NotFoundError();
    }

    // Step 2: the windows, against one clock reading.
    for (const target of targets) {
      if (target.cycleStatus !== "open") {
        throw new ConflictError("This recruitment cycle is not accepting submissions.");
      }
      if (!hasOpened(target.cycleOpensAt, now)) {
        throw new ConflictError("This recruitment cycle has not opened yet.");
      }
      if (target.cycleClosesAt !== null && target.cycleClosesAt <= now) {
        throw new ConflictError("The deadline for this recruitment cycle has passed.");
      }
      if (target.openingStatus !== "open" || !hasOpened(target.openingOpensAt, now)) {
        throw new ConflictError(`${target.committeeName} is not accepting submissions.`);
      }
      if (target.openingClosesAt !== null && target.openingClosesAt <= now) {
        throw new ConflictError(`The deadline for ${target.committeeName} has passed.`);
      }
      if (target.withdrawnAt !== null) {
        throw new ConflictError("This application has been withdrawn.");
      }
      if (target.status !== "draft") {
        throw new ConflictError("This application has already been submitted.");
      }
    }

    const cycleId = targets[0]!.cycleId;

    /*
     * Step 4 and 5: the common response, then each committee's.
     *
     * Validated with the same `validateResponse` the browser uses, so the two
     * cannot disagree about what was required — and only **visible** questions
     * are required. Demanding an answer the applicant was never shown is the
     * worst failure available here, because nothing on screen explains it.
     */
    const commonCheck = await validateResponseFor({ cycleId, profileId: profile.id });
    const problems: ApplicationProblems[] = [];

    if (commonCheck !== null && !commonCheck.result.ok) {
      problems.push({
        applicationId: "common",
        committeeName: "Shared questions",
        missing: commonCheck.result.missing,
        invalid: commonCheck.result.invalid,
      });
    }

    const perApplication: {
      target: (typeof targets)[number];
      responseId: string;
      versionId: string;
      keep: AnswerMap;
      questionIds: Map<string, string>;
    }[] = [];

    for (const target of targets) {
      const check = await validateResponseFor({
        cycleId,
        openingId: target.openingId,
        applicationId: target.id,
      });
      if (check === null) {
        throw new ConflictError(`${target.committeeName} has no published application form.`);
      }
      if (!check.result.ok) {
        problems.push({
          applicationId: target.id,
          committeeName: target.committeeName,
          missing: check.result.missing,
          invalid: check.result.invalid,
        });
        continue;
      }
      perApplication.push({
        target,
        responseId: check.responseId,
        versionId: check.versionId,
        keep: check.result.answers,
        questionIds: check.questionIds,
      });
    }

    // Step 6: uploads must be committed and the applicant's own.
    const referenced = [
      ...(commonCheck === null ? [] : fileRefs(commonCheck.keep)),
      ...perApplication.flatMap((entry) => fileRefs(entry.keep)),
    ];
    if (referenced.length > 0) {
      const usable = await db
        .select({ id: file.id })
        .from(file)
        .where(
          and(
            inArray(file.id, referenced),
            eq(file.ownerUserId, userId),
            eq(file.status, "committed"),
          ),
        );
      if (usable.length !== new Set(referenced).size) {
        // Deliberately does not say which, or whose. Attaching somebody else's
        // upload would put their document in front of a committee under this
        // applicant's name, and reporting the difference between "not yours"
        // and "not finished" would confirm the file exists.
        throw new ValidationFailedError("An attached file is not available.");
      }
    }

    if (problems.length > 0) {
      throw new ValidationFailedError("Some answers are missing or not acceptable.", problems);
    }

    /*
     * Steps 7, 8 and 9. Nothing above has written anything.
     *
     * The response is returned after this resolves, so a read immediately
     * afterwards already sees the submission — the alternative is somebody
     * seeing a confirmation for work that was not saved.
     */
    const submittedAt = await db.transaction(async (tx) => {
      const [record] = await tx
        .insert(submission)
        .values({ candidateProfileId: profile.id, idempotencyKey, submittedAt: now })
        .returning({ id: submission.id });

      for (const entry of perApplication) {
        await pruneHiddenAnswers(tx, entry);
        await tx
          .update(formResponse)
          .set({ status: "submitted", submittedAt: now, updatedAt: now })
          .where(eq(formResponse.id, entry.responseId));

        const updated = await tx
          .update(application)
          .set({
            status: "submitted",
            submittedAt: now,
            updatedAt: now,
            submissionId: record!.id,
          })
          .where(and(eq(application.id, entry.target.id), eq(application.status, "draft")))
          .returning({ id: application.id });

        if (updated.length === 0) {
          // Somebody submitted this between the checks and here. Refusing
          // aborts the whole transaction, which is the correct outcome for an
          // all-or-nothing batch.
          throw new ConflictError("This application has already been submitted.");
        }

        await tx.insert(applicationStatusEvent).values({
          applicationId: entry.target.id,
          // The status under which it was checked and updated, which is the
          // only value `draft` can have been.
          oldStatus: "draft",
          newStatus: "submitted",
          event: "submitted",
          // The applicant's own act.
          changedBy: null,
          createdAt: now,
        });
      }

      if (commonCheck !== null) {
        await pruneHiddenAnswers(tx, commonCheck);
        await tx
          .update(formResponse)
          .set({ status: "submitted", submittedAt: now, updatedAt: now })
          .where(eq(formResponse.id, commonCheck.responseId));
      }

      /*
       * Lock the shared answers, now that a committee has them.
       *
       * Only on success. Locking on a failed attempt would leave somebody
       * unable to fix the very answers the failure was about.
       */
      await tx
        .update(candidateProfile)
        .set({ commonLockedAt: now, updatedAt: now })
        .where(eq(candidateProfile.id, profile.id));

      const [person] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));

      // One email for the act, not one per committee. Two would read as a bug.
      await enqueueNotification(tx, {
        template: "submission-confirmation",
        recipientEmail: person!.email,
        payload: {
          // Counts and names only. No answers — see product rule 6.
          committeeNames: perApplication.map((entry) => entry.target.committeeName),
          submittedAt: now.toISOString(),
        },
      });

      return now;
    });

    return {
      submitted: perApplication.map((entry) => ({
        applicationId: entry.target.id,
        committeeName: entry.target.committeeName,
        submittedAt: submittedAt.toISOString(),
      })),
    };
  },
};

/**
 * The file ids an answer set references.
 *
 * Takes the map rather than a wrapper, because the dual-shaped version was how
 * the empty-keep bug hid: two optional fields, and the caller silently reading
 * whichever happened to be set.
 */
function fileRefs(answers: AnswerMap): string[] {
  return Object.values(answers).filter(
    (value): value is string => typeof value === "string" && isUuid(value),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Removes answers to questions the rules hide.
 *
 * The applicant answered, then changed an earlier answer so the question
 * disappeared. Submitting the orphan would put text in front of a reviewer that
 * the applicant believes they removed.
 */
async function pruneHiddenAnswers(
  tx: Transaction,
  entry: { responseId: string; keep: AnswerMap; questionIds: Map<string, string> },
): Promise<void> {
  const keepIds = [...entry.questionIds.entries()]
    .filter(([key]) => key in entry.keep)
    .map(([, id]) => id);

  const stored = await tx
    .select({ id: answer.id, questionId: answer.questionId })
    .from(answer)
    .where(eq(answer.formResponseId, entry.responseId));

  const drop = stored.filter((row) => !keepIds.includes(row.questionId)).map((row) => row.id);
  if (drop.length > 0) {
    await tx.delete(answer).where(inArray(answer.id, drop));
  }
}

/**
 * Loads a response and validates it against its published form version.
 *
 * Returns null when the form does not exist or has no published version, which
 * the caller turns into the right refusal for its context.
 */
async function validateResponseFor(opts: {
  cycleId: string;
  openingId?: string;
  profileId?: string;
  applicationId?: string;
}) {
  const [formRow] = await db
    .select({ id: form.id })
    .from(form)
    .where(
      opts.openingId === undefined
        ? and(eq(form.cycleId, opts.cycleId), eq(form.kind, "common"))
        : and(eq(form.openingId, opts.openingId), eq(form.kind, "committee")),
    );
  if (!formRow) {
    return null;
  }

  const [version] = await db
    .select({ id: formVersion.id })
    .from(formVersion)
    .where(and(eq(formVersion.formId, formRow.id), eq(formVersion.status, "published")))
    .orderBy(desc(formVersion.version))
    .limit(1);
  if (!version) {
    return null;
  }

  const questionRows = await db
    .select({
      id: question.id,
      questionKey: question.questionKey,
      type: question.type,
      label: question.label,
      description: question.description,
      required: question.required,
      position: question.position,
      configJson: question.configJson,
      visibilityRuleJson: question.visibilityRuleJson,
    })
    .from(question)
    .where(eq(question.formVersionId, version.id))
    .orderBy(asc(question.position));

  const [response] = await db
    .select({ id: formResponse.id })
    .from(formResponse)
    .where(
      opts.applicationId === undefined
        ? and(
            eq(formResponse.candidateProfileId, opts.profileId!),
            eq(formResponse.formVersionId, version.id),
          )
        : eq(formResponse.applicationId, opts.applicationId),
    );

  const answers: AnswerMap = {};
  if (response) {
    const rows = await db
      .select({ questionKey: question.questionKey, value: answer.valueJsonb })
      .from(answer)
      .innerJoin(question, eq(answer.questionId, question.id))
      .where(eq(answer.formResponseId, response.id));
    for (const row of rows) {
      answers[row.questionKey] = row.value as AnswerValue;
    }
  }

  const definitions = questionRows.map(toDefinition);
  return {
    responseId: response?.id ?? "",
    versionId: version.id,
    questionIds: new Map(questionRows.map((row) => [row.questionKey, row.id])),
    result: validateResponse(definitions, answers),
    /*
     * The answers to actually keep: visible questions only.
     *
     * This was `{}`, which made the prune below delete every answer on a
     * successful submission. A committee would have received an application
     * with nothing in it, and the applicant would have seen a confirmation.
     * The test that should have caught it only checked the `commonLocked` flag.
     */
    keep: validateResponse(definitions, answers).answers,
  };
}
