import type { AnswerMap, AnswerValue } from "@recruit/common";
import {
  answer,
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
} from "@recruit/db/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { currentCycleOrder, hasOpened, visibleCycleWhere } from "../lib/cycleVisibility.ts";
import { db } from "../lib/db.ts";
import { ConflictError, NotFoundError } from "../middlewares/errorHandler.ts";

/**
 * What an applicant is told about their own application.
 *
 * `status` is a **projection** of the internal column, never the column itself.
 * `shortlisted` surfaces as "Under Review": an applicant learning they are on a
 * shortlist before a decision is released would be a disclosure with real
 * consequences for them, and for the committee's ability to change its mind.
 */
export type ApplicantStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Interview"
  | "Decision Available"
  | "Withdrawn";

export interface ApplicationSummary {
  applicationId: string;
  openingId: string;
  committeeName: string;
  committeeSlug: string;
  status: ApplicantStatus;
  lastSavedAt: string | null;
  submittedAt: string | null;
}

export interface ApplicationDetail extends ApplicationSummary {
  formId: string | null;
  revision: number;
  answers: AnswerMap;
}

export interface DraftSaved {
  revision: number;
  savedAt: string;
}

/**
 * The internal status, as an applicant sees it.
 *
 * Deliberately lossy and deliberately a function rather than a map lookup at
 * the call site, so there is one place to check when somebody asks what an
 * applicant can learn.
 */
function projectStatus(status: string, decisionsReleasedAt: Date | null): ApplicantStatus {
  switch (status) {
    case "draft":
      return "Draft";
    case "withdrawn":
      return "Withdrawn";
    case "submitted":
      return "Submitted";
    case "interview":
      return "Interview";
    case "decided":
      // A decision exists, but the applicant learns of it only once the
      // organization has released it. Until then this is indistinguishable
      // from being under review, which is the point.
      return decisionsReleasedAt === null ? "Under Review" : "Decision Available";
    case "under_review":
    case "shortlisted":
    default:
      return "Under Review";
  }
}

/**
 * Cycle statuses in which an applicant may still change their own work.
 *
 * Narrower than `APPLICANT_VISIBLE_CYCLE_STATUSES` in `cycleVisibility.ts`: a
 * closed or archived cycle
 * is readable but not writable, which is the asymmetry that lets somebody read
 * back what they submitted without being able to alter it afterwards.
 */
const WRITABLE_CYCLE_STATUSES = ["open"] as const;

/**
 * Whether a window is open for writing *right now*.
 *
 * Note the asymmetry with reading, which is deliberate and documented in
 * `cycleVisibility.ts`: a read ignores `closesAt` so a submitted application
 * stays legible beside its questions, and a **write** enforces it. Collapsing
 * the two would either lock people out of their own history or let them edit
 * after the deadline.
 *
 * The status is not sufficient on its own. A transition job may not have run,
 * or nobody flipped it — the deadline is the authority, which is the entire
 * point of evaluating it server-side.
 */
function isWritableWindow(
  window: { opensAt: Date | null; closesAt: Date | null },
  now: Date,
): boolean {
  return hasOpened(window.opensAt, now) && (window.closesAt === null || window.closesAt > now);
}

function assertWritable(
  cycle: { status: string; opensAt: Date | null; closesAt: Date | null },
  now: Date,
): void {
  if (!WRITABLE_CYCLE_STATUSES.includes(cycle.status as (typeof WRITABLE_CYCLE_STATUSES)[number])) {
    throw new ConflictError("This recruitment cycle is not accepting changes.");
  }
  if (!hasOpened(cycle.opensAt, now)) {
    throw new ConflictError("This recruitment cycle has not opened yet.");
  }
  if (cycle.closesAt !== null && cycle.closesAt <= now) {
    throw new ConflictError("The deadline for this recruitment cycle has passed.");
  }
}

/**
 * Application statuses an applicant may still edit.
 *
 * Only `draft`. Once submitted, a committee may already have read it, and a
 * silent edit afterwards would change what they were looking at.
 */
const EDITABLE_APPLICATION_STATUSES = ["draft"] as const;

/**
 * Application statuses an applicant may withdraw from **before** a decision is released.
 *
 * Includes `decided`, and that is the whole point. `projectStatus` hides
 * `decided` as "Under Review" until release; refusing a withdrawal with a
 * message about a decision would tell the applicant precisely what that hiding
 * is for, turning this endpoint into an oracle for unreleased outcomes.
 *
 * Nothing is erased by allowing it. The committee's decision is an append-only
 * `application_status_event`, so moving the status column to `withdrawn` leaves
 * the record of what they concluded intact.
 */
const WITHDRAWABLE_BEFORE_RELEASE = [
  "draft",
  "submitted",
  "under_review",
  "shortlisted",
  "interview",
  "decided",
] as const;

/**
 * Application statuses an applicant may withdraw from **after** release.
 *
 * `decided` drops out. The applicant can now see the decision, so saying so
 * reveals nothing — and withdrawing is the wrong act: declining an offer is its
 * own event, with its own meaning for a committee's headcount.
 */
const WITHDRAWABLE_AFTER_RELEASE = [
  "draft",
  "submitted",
  "under_review",
  "shortlisted",
  "interview",
] as const;

/**
 * The caller's profile for the current cycle, created if this is their first visit.
 *
 * An applicant should not have to perform a setup step before they can start.
 * The profile is an implementation detail of "this person is applying this
 * cycle", so it appears when they first look.
 */
async function ensureProfile(userId: string) {
  const now = new Date();
  const [cycle] = await db
    .select()
    .from(recruitmentCycle)
    /*
     * Only cycles an applicant may see, and only ones that have opened.
     *
     * Without the filter, a draft cycle somebody is setting up for next season
     * became "the current cycle" — disclosing its name and dates, and detaching
     * every applicant from the cycle they were actually applying to.
     */
    .where(visibleCycleWhere(now))
    // The current cycle is the most recently opened one. There is deliberately
    // no "is current" flag: two rows could both claim it, and the question
    // "which cycle am I applying to" would have two answers.
    .orderBy(currentCycleOrder)
    .limit(1);

  if (!cycle) {
    // Deliberately says nothing about a cycle that exists but is hidden.
    throw new NotFoundError("There is no recruitment cycle at the moment.");
  }

  const [existing] = await db
    .select()
    .from(candidateProfile)
    .where(and(eq(candidateProfile.userId, userId), eq(candidateProfile.cycleId, cycle.id)));
  if (existing) {
    return { profile: existing, cycle };
  }

  const [created] = await db
    .insert(candidateProfile)
    .values({ userId, cycleId: cycle.id, createdAt: now, updatedAt: now })
    // Two tabs landing at once would otherwise race the unique index. The
    // constraint is the backstop; this makes the ordinary case quiet.
    .onConflictDoNothing()
    .returning();
  if (created) {
    return { profile: created, cycle };
  }

  const [raced] = await db
    .select()
    .from(candidateProfile)
    .where(and(eq(candidateProfile.userId, userId), eq(candidateProfile.cycleId, cycle.id)));
  return { profile: raced!, cycle };
}

/** The published version of a form, and its questions, or null. */
async function publishedVersion(formId: string) {
  const [version] = await db
    .select({ id: formVersion.id })
    .from(formVersion)
    .where(and(eq(formVersion.formId, formId), eq(formVersion.status, "published")))
    .orderBy(desc(formVersion.version))
    .limit(1);
  if (!version) {
    return null;
  }
  const questions = await db
    .select({ id: question.id, questionKey: question.questionKey })
    .from(question)
    .where(eq(question.formVersionId, version.id))
    .orderBy(asc(question.position));
  return { versionId: version.id, questions };
}

/**
 * Writes answers into a response, with an optimistic concurrency check.
 *
 * The revision is the whole mechanism. A student with a laptop and a phone both
 * autosaving is the ordinary case, not an edge case, and taking the last write
 * would lose whatever the slower tab did not have. So a stale revision is
 * refused with the current one, and the client tells the person rather than
 * silently discarding either side.
 *
 * The write is a **merge**, not a replacement: autosave sends what changed, and
 * dropping everything it did not mention would destroy work with every
 * keystroke in a different field.
 */
async function saveAnswers(opts: {
  responseId: string;
  versionId: string;
  expectedRevision: number;
  answers: { questionKey: string; value: AnswerValue }[];
  questionIds: Map<string, string>;
}): Promise<DraftSaved> {
  const now = new Date();

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ revision: formResponse.revision, status: formResponse.status })
      .from(formResponse)
      .where(eq(formResponse.id, opts.responseId))
      .for("update");

    if (!current) {
      throw new NotFoundError();
    }
    if (current.status === "submitted") {
      throw new ConflictError("This response has already been submitted.");
    }
    if (current.revision !== opts.expectedRevision) {
      throw new ConflictError("Somebody has saved newer answers.", {
        currentRevision: current.revision,
      });
    }

    for (const entry of opts.answers) {
      const questionId = opts.questionIds.get(entry.questionKey);
      if (questionId === undefined) {
        // A client can send anything. Only what the published form defines is
        // stored; the composite foreign key would refuse the rest regardless.
        continue;
      }
      await tx
        .insert(answer)
        .values({
          formResponseId: opts.responseId,
          formVersionId: opts.versionId,
          questionId,
          valueJsonb: entry.value,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [answer.formResponseId, answer.questionId],
          set: { valueJsonb: entry.value, updatedAt: now },
        });
    }

    const nextRevision = current.revision + 1;
    await tx
      .update(formResponse)
      .set({ revision: nextRevision, updatedAt: now })
      .where(eq(formResponse.id, opts.responseId));

    return { revision: nextRevision, savedAt: now.toISOString() };
  });
}

async function readAnswers(responseId: string): Promise<AnswerMap> {
  const rows = await db
    .select({ questionKey: question.questionKey, value: answer.valueJsonb })
    .from(answer)
    .innerJoin(question, eq(answer.questionId, question.id))
    .where(eq(answer.formResponseId, responseId));
  return Object.fromEntries(rows.map((row) => [row.questionKey, row.value as AnswerValue]));
}

/**
 * The caller's application, or 404.
 *
 * Scoped by profile in the query itself rather than fetched and then checked.
 * A row the caller does not own is indistinguishable from one that does not
 * exist, which is what stops the platform confirming that somebody else's
 * application is there.
 */
async function ownedApplication(profileId: string, applicationId: string) {
  const [row] = await db
    .select({
      id: application.id,
      status: application.status,
      submittedAt: application.submittedAt,
      withdrawnAt: application.withdrawnAt,
      updatedAt: application.updatedAt,
      openingId: application.openingId,
      committeeName: team.name,
      committeeSlug: team.slug,
      openingStatus: recruitmentOpening.status,
      openingOpensAt: recruitmentOpening.opensAt,
      openingClosesAt: recruitmentOpening.closesAt,
      cycleStatus: recruitmentCycle.status,
      cycleOpensAt: recruitmentCycle.opensAt,
      decisionsReleasedAt: recruitmentCycle.decisionsReleasedAt,
    })
    .from(application)
    .innerJoin(recruitmentOpening, eq(application.openingId, recruitmentOpening.id))
    .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
    .innerJoin(recruitmentCycle, eq(recruitmentOpening.cycleId, recruitmentCycle.id))
    .where(and(eq(application.id, applicationId), eq(application.candidateProfileId, profileId)));
  if (!row) {
    throw new NotFoundError();
  }
  return row;
}

export const applicationService = {
  getProfile: async (userId: string) => {
    const { profile, cycle } = await ensureProfile(userId);
    return {
      cycleSlug: cycle.slug,
      cycleName: cycle.name,
      closesAt: cycle.closesAt?.toISOString() ?? null,
      commonLocked: profile.commonLockedAt !== null,
    };
  },

  listApplications: async (userId: string): Promise<ApplicationSummary[]> => {
    const { profile } = await ensureProfile(userId);
    const rows = await db
      .select({
        id: application.id,
        openingId: application.openingId,
        status: application.status,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
        committeeName: team.name,
        committeeSlug: team.slug,
        decisionsReleasedAt: recruitmentCycle.decisionsReleasedAt,
      })
      .from(application)
      .innerJoin(recruitmentOpening, eq(application.openingId, recruitmentOpening.id))
      .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
      .innerJoin(recruitmentCycle, eq(recruitmentOpening.cycleId, recruitmentCycle.id))
      .where(eq(application.candidateProfileId, profile.id))
      .orderBy(asc(team.displayOrder));

    return rows.map((row) => ({
      applicationId: row.id,
      openingId: row.openingId,
      committeeName: row.committeeName,
      committeeSlug: row.committeeSlug,
      status: projectStatus(row.status, row.decisionsReleasedAt),
      lastSavedAt: row.updatedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
    }));
  },

  /**
   * Starts an application, or returns the one already in progress.
   *
   * Not an error on a second attempt. Somebody clicking Apply twice, or
   * returning to the committee page, should land on the application they
   * already started — not be told they cannot apply to a committee they are
   * midway through applying to.
   */
  createApplication: async (
    userId: string,
    openingId: string,
  ): Promise<{ created: boolean; summary: ApplicationSummary }> => {
    const now = new Date();
    const { profile, cycle } = await ensureProfile(userId);
    assertWritable(cycle, now);

    const [opening] = await db
      .select({
        id: recruitmentOpening.id,
        status: recruitmentOpening.status,
        opensAt: recruitmentOpening.opensAt,
        closesAt: recruitmentOpening.closesAt,
        committeeName: team.name,
        committeeSlug: team.slug,
      })
      .from(recruitmentOpening)
      .innerJoin(team, eq(recruitmentOpening.teamId, team.id))
      .where(and(eq(recruitmentOpening.id, openingId), eq(recruitmentOpening.cycleId, cycle.id)));
    if (!opening) {
      throw new NotFoundError();
    }
    if (opening.status !== "open") {
      throw new ConflictError("This committee is not accepting applications.");
    }
    if (!isWritableWindow(opening, now)) {
      throw new ConflictError(
        hasOpened(opening.opensAt, now)
          ? "The deadline for this committee has passed."
          : "This committee has not opened yet.",
      );
    }

    /*
     * A committee that is open but has published no questions.
     *
     * Refused here rather than discovered later. Declaring an opening open and
     * publishing its form are separate acts, so a director can do one and
     * forget the other — and without this check somebody starts an application
     * they cannot fill in, then meets an unexplained 404 on their first save.
     */
    const [committeeForm] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.openingId, openingId), eq(form.kind, "committee")));
    const published = committeeForm ? await publishedVersion(committeeForm.id) : null;
    if (!published) {
      throw new ConflictError("This committee's application is not ready yet.");
    }

    const [existing] = await db
      .select({ id: application.id, status: application.status, updatedAt: application.updatedAt })
      .from(application)
      .where(
        and(eq(application.candidateProfileId, profile.id), eq(application.openingId, openingId)),
      );
    if (existing) {
      return {
        created: false,
        summary: {
          applicationId: existing.id,
          openingId,
          committeeName: opening.committeeName,
          committeeSlug: opening.committeeSlug,
          status: projectStatus(existing.status, cycle.decisionsReleasedAt),
          lastSavedAt: existing.updatedAt.toISOString(),
          submittedAt: null,
        },
      };
    }

    /*
     * Counting and inserting in one transaction, behind a lock on the profile.
     *
     * Two tabs submitting at once would otherwise both pass the count and both
     * insert — the classic check-then-act race, and here it quietly breaks a
     * limit the organization set. Locking the profile serializes one
     * applicant's creations without contending with anybody else's.
     */
    const created = await db.transaction(async (tx) => {
      await tx
        .select({ id: candidateProfile.id })
        .from(candidateProfile)
        .where(eq(candidateProfile.id, profile.id))
        .for("update");

      if (cycle.maxCommitteesPerApplicant !== null) {
        const held = await tx
          .select({ id: application.id })
          .from(application)
          .where(
            and(eq(application.candidateProfileId, profile.id), isNull(application.withdrawnAt)),
          );
        if (held.length >= cycle.maxCommitteesPerApplicant) {
          throw new ConflictError(
            `This cycle allows ${cycle.maxCommitteesPerApplicant} committee${
              cycle.maxCommitteesPerApplicant === 1 ? "" : "s"
            } per applicant. Withdraw one to apply elsewhere.`,
          );
        }
      }

      const [row] = await tx
        .insert(application)
        .values({
          candidateProfileId: profile.id,
          openingId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: application.id });
      return row;
    });

    return {
      created: true,
      summary: {
        applicationId: created!.id,
        openingId,
        committeeName: opening.committeeName,
        committeeSlug: opening.committeeSlug,
        status: "Draft",
        lastSavedAt: now.toISOString(),
        submittedAt: null,
      },
    };
  },

  getApplication: async (userId: string, applicationId: string): Promise<ApplicationDetail> => {
    const { profile, cycle } = await ensureProfile(userId);
    const row = await ownedApplication(profile.id, applicationId);

    const [committeeForm] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.openingId, row.openingId), eq(form.kind, "committee")));

    const [response] = await db
      .select({ id: formResponse.id, revision: formResponse.revision })
      .from(formResponse)
      .where(eq(formResponse.applicationId, applicationId));

    return {
      applicationId: row.id,
      openingId: row.openingId,
      committeeName: row.committeeName,
      committeeSlug: row.committeeSlug,
      status: projectStatus(row.status, cycle.decisionsReleasedAt),
      lastSavedAt: row.updatedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      formId: committeeForm?.id ?? null,
      revision: response?.revision ?? 0,
      answers: response ? await readAnswers(response.id) : {},
    };
  },

  saveApplicationDraft: async (
    userId: string,
    applicationId: string,
    expectedRevision: number,
    answers: { questionKey: string; value: AnswerValue }[],
  ): Promise<DraftSaved> => {
    const now = new Date();
    const { profile, cycle } = await ensureProfile(userId);
    const row = await ownedApplication(profile.id, applicationId);
    assertWritable(cycle, now);

    // Withdrawing means "do not consider me". Editing afterwards would put work
    // in front of a committee for an application the applicant had retracted.
    if (row.withdrawnAt !== null) {
      throw new ConflictError("This application has been withdrawn.");
    }
    if (
      !EDITABLE_APPLICATION_STATUSES.includes(
        row.status as (typeof EDITABLE_APPLICATION_STATUSES)[number],
      )
    ) {
      throw new ConflictError("This application has already been submitted.");
    }

    // A committee may close earlier than its cycle. Checking only the cycle
    // would let somebody keep editing after their committee had stopped.
    if (
      row.openingStatus !== "open" ||
      !isWritableWindow({ opensAt: row.openingOpensAt, closesAt: row.openingClosesAt }, now)
    ) {
      throw new ConflictError("This committee is no longer accepting changes.");
    }

    const [committeeForm] = await db
      .select({ id: form.id })
      .from(form)
      .innerJoin(recruitmentOpening, eq(form.openingId, recruitmentOpening.id))
      .innerJoin(application, eq(application.openingId, recruitmentOpening.id))
      .where(and(eq(application.id, applicationId), eq(form.kind, "committee")));
    if (!committeeForm) {
      throw new NotFoundError("This committee has no application form yet.");
    }

    const version = await publishedVersion(committeeForm.id);
    if (!version) {
      throw new NotFoundError("This committee has no published application form yet.");
    }

    const [existing] = await db
      .select({ id: formResponse.id })
      .from(formResponse)
      .where(eq(formResponse.applicationId, applicationId));

    const responseId =
      existing?.id ??
      (
        await db
          .insert(formResponse)
          .values({
            formVersionId: version.versionId,
            applicationId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: formResponse.id })
      )[0]!.id;

    return await saveAnswers({
      responseId,
      versionId: version.versionId,
      expectedRevision,
      answers,
      questionIds: new Map(version.questions.map((q) => [q.questionKey, q.id])),
    });
  },

  saveCommonDraft: async (
    userId: string,
    expectedRevision: number,
    answers: { questionKey: string; value: AnswerValue }[],
  ): Promise<DraftSaved> => {
    const now = new Date();
    const { profile, cycle } = await ensureProfile(userId);
    assertWritable(cycle, now);

    if (profile.commonLockedAt !== null) {
      // Editing these after a submission would retroactively change an
      // application a committee has already read.
      throw new ConflictError(
        "Your shared answers are locked because you have submitted an application. Ask a recruitment administrator if they need to change.",
      );
    }

    const [commonForm] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.cycleId, cycle.id), eq(form.kind, "common")));
    if (!commonForm) {
      throw new NotFoundError("This cycle has no shared questions.");
    }

    const version = await publishedVersion(commonForm.id);
    if (!version) {
      throw new NotFoundError("This cycle's shared questions are not published yet.");
    }

    const [existing] = await db
      .select({ id: formResponse.id })
      .from(formResponse)
      .where(
        and(
          eq(formResponse.candidateProfileId, profile.id),
          eq(formResponse.formVersionId, version.versionId),
        ),
      );

    const responseId =
      existing?.id ??
      (
        await db
          .insert(formResponse)
          .values({
            formVersionId: version.versionId,
            candidateProfileId: profile.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: formResponse.id })
      )[0]!.id;

    return await saveAnswers({
      responseId,
      versionId: version.versionId,
      expectedRevision,
      answers,
      questionIds: new Map(version.questions.map((q) => [q.questionKey, q.id])),
    });
  },

  /**
   * Withdraws an application.
   *
   * Idempotent: a second call is a no-op rather than an error, because the
   * first thing somebody does after an uncertain click is click again, and
   * because two `withdrawn` events would make the history say it happened
   * twice.
   */
  withdrawApplication: async (
    userId: string,
    applicationId: string,
  ): Promise<ApplicationSummary> => {
    const now = new Date();
    const { profile, cycle } = await ensureProfile(userId);
    const row = await ownedApplication(profile.id, applicationId);

    /*
     * Deliberately more permissive than editing.
     *
     * "Please do not consider me" is reasonable after a deadline, and even
     * while a committee is reviewing. Changing your answers then is not. So
     * this checks the cycle is not archived rather than calling
     * `assertWritable`.
     */
    if (cycle.status === "archived") {
      throw new ConflictError("This recruitment cycle is closed.");
    }
    /*
     * What may be withdrawn depends on whether decisions are out.
     *
     * Before release the set is wider and the refusal message says nothing
     * about decisions, so an applicant cannot learn their outcome early by
     * trying to withdraw. After release it narrows, and the message can be
     * specific because the applicant already knows.
     */
    const released = cycle.decisionsReleasedAt !== null;
    /*
     * Typed to the enum rather than `string[]`.
     *
     * The widened type compiles everywhere except the one place it matters —
     * `inArray` against the status column — and losing it there would mean
     * dropping the gate from the write predicate to satisfy the compiler.
     */
    const withdrawable: readonly (typeof WITHDRAWABLE_BEFORE_RELEASE)[number][] = released
      ? WITHDRAWABLE_AFTER_RELEASE
      : WITHDRAWABLE_BEFORE_RELEASE;

    if (
      row.withdrawnAt === null &&
      !withdrawable.includes(row.status as (typeof WITHDRAWABLE_BEFORE_RELEASE)[number])
    ) {
      throw new ConflictError(
        released
          ? "Your decision has been released, so this application can no longer be withdrawn."
          : "This application can no longer be withdrawn.",
      );
    }

    if (row.withdrawnAt !== null) {
      return {
        applicationId: row.id,
        openingId: row.openingId,
        committeeName: row.committeeName,
        committeeSlug: row.committeeSlug,
        status: "Withdrawn",
        lastSavedAt: row.updatedAt.toISOString(),
        submittedAt: row.submittedAt?.toISOString() ?? null,
      };
    }

    await db.transaction(async (tx) => {
      /*
       * Lock, re-check, write — in that order, inside the transaction.
       *
       * The obvious shortcut is a conditional `UPDATE` with `RETURNING`, and it
       * is wrong twice over. Postgres `RETURNING` yields the **new** row, so
       * reading `status` from it gives back "withdrawn" — the value just
       * written — and the audit row then records an application moving from
       * withdrawn to withdrawn, which records nothing at all. Locking first is
       * what makes the prior status knowable *and* closes the window in which a
       * committee could record a decision between the check and the write.
       *
       * `FOR UPDATE` on this one row, so two withdrawals in flight serialize
       * against each other and the second finds the first already done.
       */
      const [locked] = await tx
        .select({ status: application.status, withdrawnAt: application.withdrawnAt })
        .from(application)
        .where(eq(application.id, applicationId))
        .for("update");

      if (!locked || locked.withdrawnAt !== null) {
        // Already withdrawn, by us a moment ago or by a concurrent request.
        // Idempotent, so this is a no-op rather than an error — and crucially
        // no second event, which would make the history say it happened twice.
        return;
      }
      if (!withdrawable.includes(locked.status as (typeof WITHDRAWABLE_BEFORE_RELEASE)[number])) {
        // A decision landed between the earlier read and this lock. Refusing
        // here rather than overwriting it is the point of taking the lock.
        throw new ConflictError("This application can no longer be withdrawn.");
      }

      await tx
        .update(application)
        .set({ status: "withdrawn", withdrawnAt: now, updatedAt: now })
        .where(eq(application.id, applicationId));

      await tx.insert(applicationStatusEvent).values({
        applicationId,
        // The status under the lock, which is what the application genuinely
        // moved from.
        oldStatus: locked.status,
        newStatus: "withdrawn",
        event: "withdrawn",
        // Null, because this is the applicant's own act. Naming a staff member
        // would be a false record.
        changedBy: null,
        createdAt: now,
      });
    });
    return {
      applicationId: row.id,
      openingId: row.openingId,
      committeeName: row.committeeName,
      committeeSlug: row.committeeSlug,
      status: "Withdrawn",
      lastSavedAt: now.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
    };
  },
};
