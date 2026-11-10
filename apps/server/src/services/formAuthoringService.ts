import type { AppAbility } from "@recruit/access-control";
import type { QuestionConfig, QuestionDefinition, VisibilityRule } from "@recruit/common";
import { CONTENT_ONLY_TYPES, validateFormRules } from "@recruit/common";
import { form, formVersion, question } from "@recruit/db/schema";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";

import { assertCan } from "../lib/authorize.ts";
import { db } from "../lib/db.ts";
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from "../middlewares/errorHandler.ts";

/** The question types a form may contain. Closed, and checked on every write. */
const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "dropdown",
  "number",
  "url",
  "file_upload",
  "section_heading",
  "static_content",
] as const;

type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Where positions are parked during a reorder.
 *
 * Far above any plausible question count, so the parked range cannot overlap
 * the final one. A form with ten thousand questions would be a different
 * problem.
 */
const PARKING_OFFSET = 100_000;

/** The types that need a non-empty choice list to be answerable at all. */
const CHOICE_TYPES: readonly QuestionType[] = ["single_select", "multi_select", "dropdown"];

export interface DraftView {
  formId: string;
  versionId: string;
  kind: "common" | "committee";
  title: string;
  description: string | null;
  version: number;
  status: "draft";
  questions: QuestionDefinition[];
}

export interface QuestionInput {
  questionKey: string;
  type: string;
  label: string;
  description?: string | null;
  required?: boolean;
  config?: QuestionConfig | null;
  visibilityRule?: VisibilityRule | null;
}

function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value);
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
    config: (row.configJson ?? null) as QuestionConfig | null,
    visibilityRule: (row.visibilityRuleJson ?? null) as VisibilityRule | null,
  };
}

/**
 * The form, and the attributes its rules compile against.
 *
 * `teamId` is null for a common form, which is what makes it the
 * organization's — the database enforces that with a check constraint, so the
 * rule and the schema are making the same statement.
 */
async function ownedForm(ability: AppAbility, formId: string, action: "update" | "publish") {
  // Checked before the query, because Postgres errors on a failed uuid cast and
  // a malformed id would become a server fault.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    throw new NotFoundError();
  }

  const [row] = await db
    .select({
      id: form.id,
      cycleId: form.cycleId,
      teamId: form.teamId,
      kind: form.kind,
      title: form.title,
      description: form.description,
    })
    .from(form)
    .where(eq(form.id, formId));
  if (!row) {
    throw new NotFoundError();
  }

  assertCan(ability, action, "Form", { teamId: row.teamId });
  return row;
}

/** The newest draft version of a form, or null. */
async function currentDraft(formId: string) {
  const [row] = await db
    .select()
    .from(formVersion)
    .where(and(eq(formVersion.formId, formId), eq(formVersion.status, "draft")))
    .orderBy(desc(formVersion.version))
    .limit(1);
  return row ?? null;
}

/**
 * The draft to edit, created on demand and pre-filled from the last published
 * version.
 *
 * Two things this gets right that are easy to get wrong.
 *
 * **Copying.** A published version is immutable, so fixing a typo means a new
 * version — and without copying the questions forward, a director would retype
 * the entire form to change one word. Copying is what makes the immutability
 * liveable rather than a reason to work around it.
 *
 * **One draft, ever.** The database enforces it with a partial unique index;
 * this returns the existing one rather than racing that constraint, so two
 * builder tabs open at once is an ordinary thing rather than a 500.
 */
async function ensureDraft(formId: string, userId: string) {
  const existing = await currentDraft(formId);
  if (existing !== null) {
    return existing;
  }

  const now = new Date();
  const [latest] = await db
    .select({ id: formVersion.id, version: formVersion.version })
    .from(formVersion)
    .where(eq(formVersion.formId, formId))
    .orderBy(desc(formVersion.version))
    .limit(1);

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(formVersion)
      .values({
        formId,
        version: (latest?.version ?? 0) + 1,
        status: "draft",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      // Two tabs landing together would otherwise race the partial unique
      // index; the constraint is the backstop and this makes the ordinary case
      // quiet.
      .onConflictDoNothing()
      .returning();

    if (created === undefined) {
      const raced = await currentDraft(formId);
      if (raced === null) {
        throw new ConflictError("Could not open a draft. Reload and try again.");
      }
      return raced;
    }

    if (latest !== undefined) {
      const previous = await tx
        .select()
        .from(question)
        .where(eq(question.formVersionId, latest.id))
        .orderBy(asc(question.position));

      if (previous.length > 0) {
        await tx.insert(question).values(
          previous.map((row) => ({
            formVersionId: created.id,
            questionKey: row.questionKey,
            type: row.type,
            label: row.label,
            description: row.description,
            required: row.required,
            position: row.position,
            configJson: row.configJson,
            visibilityRuleJson: row.visibilityRuleJson,
          })),
        );
      }
    }

    return created;
  });
}

/**
 * The draft a question belongs to, refusing anything published.
 *
 * This is the single chokepoint for immutability. Every write that names a
 * question id comes through here, so "a published question cannot change" is
 * one check rather than one per route — and a new route that forgets it would
 * have to go out of its way to.
 */
async function draftQuestion(ability: AppAbility, questionId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId)) {
    throw new NotFoundError();
  }

  const [row] = await db
    .select({
      id: question.id,
      formVersionId: question.formVersionId,
      versionStatus: formVersion.status,
      formId: formVersion.formId,
      teamId: form.teamId,
    })
    .from(question)
    .innerJoin(formVersion, eq(question.formVersionId, formVersion.id))
    .innerJoin(form, eq(formVersion.formId, form.id))
    .where(eq(question.id, questionId));
  if (!row) {
    throw new NotFoundError();
  }

  assertCan(ability, "update", "Form", { teamId: row.teamId });

  if (row.versionStatus !== "draft") {
    /*
     * **The central integrity rule of the product.**
     *
     * A `form_response` names the exact version it was answered against, so a
     * published question changing underneath it would turn every stored answer
     * into a reply to a question nobody asked. 409 rather than 404 is
     * deliberate here: the caller is allowed to see this question, so hiding
     * it would be a lie — what they cannot do is change it.
     */
    throw new ConflictError(
      "This version has been published and can no longer be changed. Open a new draft to make changes.",
    );
  }

  return row;
}

/** Rejects a question the renderer or the validator could not handle. */
function validateQuestionInput(input: QuestionInput): {
  type: QuestionType;
  required: boolean;
  config: QuestionConfig | null;
} {
  if (!isQuestionType(input.type)) {
    throw new ValidationFailedError(`"${input.type}" is not a question type.`);
  }
  if (input.label.trim() === "") {
    throw new ValidationFailedError("A question needs a label.");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input.questionKey)) {
    // The key appears in an answer map and in a visibility rule, so it has to
    // be addressable and stable.
    throw new ValidationFailedError(
      "A question key must start with a letter and contain only letters, numbers, hyphens and underscores.",
    );
  }

  const config = input.config ?? null;
  if (CHOICE_TYPES.includes(input.type) && (config?.choices?.length ?? 0) === 0) {
    /*
     * Refused now rather than at publish.
     *
     * `validateFormRules` would catch it then, but a select with no choices is
     * a question nobody can answer and the director is right here — telling
     * them at publish time means discovering it after the whole form is built.
     */
    throw new ValidationFailedError(`"${input.label}" is a choice question with no choices.`);
  }

  /*
   * A heading is never required.
   *
   * `required: true` on something that carries no answer is a
   * misconfiguration, not an instruction: nothing could satisfy it and the
   * form would be unsubmittable. Normalised rather than refused, because the
   * intent is obvious and refusing would be pedantry.
   */
  const required = CONTENT_ONLY_TYPES.includes(input.type) ? false : (input.required ?? false);

  return { type: input.type, required, config };
}

export const formAuthoringService = {
  /** Every form in a cycle the caller may edit. */
  listForms: async (ability: AppAbility, cycleId: string) => {
    const rows = await db
      .select({
        formId: form.id,
        kind: form.kind,
        title: form.title,
        teamId: form.teamId,
        openingId: form.openingId,
      })
      .from(form)
      .where(eq(form.cycleId, cycleId))
      .orderBy(asc(form.kind), asc(form.title));

    /*
     * Filtered by the ability, one row at a time.
     *
     * `drizzleWhere` is the better tool when the rule compiles against the
     * table, and here it does — but `form.team_id` is nullable and a common
     * form's rule is `teamId: null` while a committee's is `$in`, so the
     * compiled predicate would be the union of two rules over the same
     * column. Evaluating per row is equivalent and legible; the list is at
     * most a handful of forms per cycle.
     */
    return rows.filter((row) => {
      try {
        assertCan(ability, "update", "Form", { teamId: row.teamId });
        return true;
      } catch {
        return false;
      }
    });
  },

  /** The draft, created on demand. */
  getDraft: async (ability: AppAbility, formId: string, userId: string): Promise<DraftView> => {
    const row = await ownedForm(ability, formId, "update");
    const draft = await ensureDraft(formId, userId);

    const questions = await db
      .select()
      .from(question)
      .where(eq(question.formVersionId, draft.id))
      .orderBy(asc(question.position));

    return {
      formId: row.id,
      versionId: draft.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      version: draft.version,
      status: "draft",
      questions: questions.map(toDefinition),
    };
  },

  /** Renames a form or changes its blurb. Metadata, not questions. */
  updateForm: async (
    ability: AppAbility,
    formId: string,
    input: { title?: string; description?: string | null },
  ) => {
    const row = await ownedForm(ability, formId, "update");
    const now = new Date();

    if (input.title !== undefined && input.title.trim() === "") {
      throw new ValidationFailedError("A form needs a title.");
    }

    await db
      .update(form)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        updatedAt: now,
      })
      .where(eq(form.id, row.id));

    return { formId: row.id };
  },

  addQuestion: async (
    ability: AppAbility,
    formId: string,
    userId: string,
    input: QuestionInput,
  ) => {
    await ownedForm(ability, formId, "update");
    const checked = validateQuestionInput(input);
    const draft = await ensureDraft(formId, userId);

    const existing = await db
      .select({ questionKey: question.questionKey, position: question.position })
      .from(question)
      .where(eq(question.formVersionId, draft.id));

    if (existing.some((row) => row.questionKey === input.questionKey)) {
      // A key is how an answer finds its question, so two in one version would
      // make a stored answer ambiguous. The database has a unique index too;
      // this is the message the director can act on.
      throw new ConflictError(`This form already has a question keyed "${input.questionKey}".`);
    }

    const [{ highest } = { highest: null }] = await db
      .select({ highest: max(question.position) })
      .from(question)
      .where(eq(question.formVersionId, draft.id));

    const [created] = await db
      .insert(question)
      .values({
        formVersionId: draft.id,
        questionKey: input.questionKey,
        type: checked.type,
        label: input.label,
        description: input.description ?? null,
        required: checked.required,
        position: (highest ?? 0) + 1,
        configJson: checked.config,
        visibilityRuleJson: input.visibilityRule ?? null,
      })
      .returning({ id: question.id, position: question.position });

    return { questionId: created!.id, position: created!.position };
  },

  updateQuestion: async (
    ability: AppAbility,
    questionId: string,
    input: Partial<QuestionInput>,
  ) => {
    const row = await draftQuestion(ability, questionId);

    const [current] = await db.select().from(question).where(eq(question.id, questionId));
    const merged: QuestionInput = {
      questionKey: input.questionKey ?? current!.questionKey,
      type: input.type ?? current!.type,
      label: input.label ?? current!.label,
      description: input.description ?? current!.description,
      required: input.required ?? current!.required,
      config: (input.config ?? current!.configJson) as QuestionConfig | null,
      visibilityRule: (input.visibilityRule ??
        current!.visibilityRuleJson) as VisibilityRule | null,
    };
    const checked = validateQuestionInput(merged);

    if (merged.questionKey !== current!.questionKey) {
      const clash = await db
        .select({ id: question.id })
        .from(question)
        .where(
          and(
            eq(question.formVersionId, row.formVersionId),
            eq(question.questionKey, merged.questionKey),
          ),
        );
      if (clash.length > 0) {
        throw new ConflictError(`This form already has a question keyed "${merged.questionKey}".`);
      }
    }

    await db
      .update(question)
      .set({
        questionKey: merged.questionKey,
        type: checked.type,
        label: merged.label,
        description: merged.description ?? null,
        required: checked.required,
        configJson: checked.config,
        visibilityRuleJson: merged.visibilityRule ?? null,
      })
      .where(eq(question.id, questionId));

    return { questionId };
  },

  deleteQuestion: async (ability: AppAbility, questionId: string) => {
    const row = await draftQuestion(ability, questionId);

    await db.delete(question).where(eq(question.id, questionId));

    /*
     * Positions are closed up afterwards.
     *
     * A gap is harmless to the renderer, which sorts — but `validateFormRules`
     * reports a position clash, and a reorder that has to reason about gaps is
     * where off-by-ones live. Cheaper to keep them contiguous.
     */
    const remaining = await db
      .select({ id: question.id })
      .from(question)
      .where(eq(question.formVersionId, row.formVersionId))
      .orderBy(asc(question.position));

    await db.transaction(async (tx) => {
      for (const [index, entry] of remaining.entries()) {
        await tx
          .update(question)
          .set({ position: index + 1 })
          .where(eq(question.id, entry.id));
      }
    });
  },

  reorder: async (ability: AppAbility, formId: string, questionIds: string[]) => {
    await ownedForm(ability, formId, "update");

    const draft = await currentDraft(formId);
    if (draft === null) {
      /*
       * No draft means the only versions are published.
       *
       * 409 rather than creating one: reordering is a change to an existing
       * arrangement, and silently opening a new version to hold it would be a
       * surprising side effect of what looks like a read-adjacent operation.
       */
      throw new ConflictError(
        "This form has no draft to reorder. Open a draft first to make changes.",
      );
    }

    const rows = await db
      .select({ id: question.id })
      .from(question)
      .where(eq(question.formVersionId, draft.id));

    const owned = new Set(rows.map((row) => row.id));
    if (new Set(questionIds).size !== questionIds.length) {
      throw new ConflictError("A question was listed more than once.");
    }
    if (questionIds.some((id) => !owned.has(id))) {
      throw new NotFoundError();
    }
    if (questionIds.length !== rows.length) {
      /*
       * The whole set, or nothing.
       *
       * A partial order leaves the omitted questions somewhere nobody chose,
       * and position decides both the display order and the order visibility
       * rules are evaluated in — so a gap is not cosmetic, it can hide a
       * question.
       */
      throw new ConflictError(
        "Send every question in the order you want them, so none is left without a position.",
      );
    }

    await db.transaction(async (tx) => {
      /*
       * Two passes, because `question_version_position_key` is unique on
       * `(form_version_id, position)`.
       *
       * Any real reordering is a permutation, so assigning final positions one
       * at a time collides with a row that has not moved yet — the first swap
       * fails and the request 500s. Parking every row above the occupied range
       * first makes each final assignment land on a free slot.
       *
       * The offset is added rather than negated because `question_position_ck`
       * requires a positive position, so the obvious trick of going negative
       * is not available.
       */
      await tx
        .update(question)
        .set({ position: sql`${question.position} + ${PARKING_OFFSET}` })
        .where(eq(question.formVersionId, draft.id));

      for (const [index, questionId] of questionIds.entries()) {
        const updated = await tx
          .update(question)
          .set({ position: index + 1 })
          // The version is in the predicate, not only in the check above: the
          // read and the write are separate statements.
          .where(and(eq(question.id, questionId), eq(question.formVersionId, draft.id)))
          .returning({ id: question.id });
        if (updated.length !== 1) {
          throw new ConflictError("The questions changed while reordering. Reload and try again.");
        }
      }
    });

    return { formId, versionId: draft.id };
  },

  /**
   * Freezes the draft, after checking everything that cannot be checked later.
   *
   * `publish` is a separate action from `update` in the vocabulary precisely
   * so a question editor can hold one and not the other — the authority check
   * is `assertCan(ability, "publish", ...)` and never a role comparison.
   */
  publish: async (ability: AppAbility, formId: string) => {
    await ownedForm(ability, formId, "publish");

    const draft = await currentDraft(formId);
    if (draft === null) {
      throw new ConflictError("There is no draft to publish.");
    }

    const rows = await db
      .select()
      .from(question)
      .where(eq(question.formVersionId, draft.id))
      .orderBy(asc(question.position));

    if (rows.length === 0) {
      throw new ValidationFailedError(
        "This form has no questions yet, so publishing it would open applications nobody can answer.",
      );
    }

    /*
     * The same `validateFormRules` the builder's preview runs.
     *
     * Reused rather than restated: it is the only place that knows a rule may
     * reference only an earlier question in the same version, and a second
     * copy of that knowledge would eventually disagree with the evaluator.
     * Forward references, self references, keys that do not exist, type
     * mismatches and choice drift are all refused here, and every problem
     * names its question — "invalid visibility rule" on a form with forty
     * questions is not something a director can act on.
     */
    const result = validateFormRules(rows.map(toDefinition));
    if (!result.ok) {
      throw new ValidationFailedError(
        "This form cannot be published yet.",
        result.problems.map((problem) => ({
          questionKey: problem.questionKey,
          message: problem.message,
        })),
      );
    }

    const now = new Date();
    const published = await db
      .update(formVersion)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      /*
       * `status = 'draft'` is in the predicate, and a zero-row result is a
       * refusal rather than a no-op.
       *
       * Two publish clicks arriving together would otherwise both report
       * success while only one did anything — and the second would have
       * published a version it never validated.
       */
      .where(and(eq(formVersion.id, draft.id), eq(formVersion.status, "draft")))
      .returning({ id: formVersion.id, version: formVersion.version });

    if (published.length !== 1) {
      throw new ConflictError("This version has already been published.");
    }

    return {
      formId,
      versionId: published[0]!.id,
      version: published[0]!.version,
      publishedAt: now.toISOString(),
    };
  },
};
