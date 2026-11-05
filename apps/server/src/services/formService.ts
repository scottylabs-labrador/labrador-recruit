import type { QuestionConfig, QuestionDefinition, VisibilityRule } from "@recruit/common";
import {
  form,
  formVersion,
  question,
  recruitmentCycle,
  recruitmentOpening,
} from "@recruit/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  APPLICANT_VISIBLE_CYCLE_STATUSES,
  APPLICANT_VISIBLE_OPENING_STATUSES,
  hasOpened,
} from "../lib/cycleVisibility.ts";
import { db } from "../lib/db.ts";

/** A published form, as an applicant receives it. */
export interface PublishedForm {
  formId: string;
  kind: "common" | "committee";
  title: string;
  description: string | null;
  version: number;
  questions: QuestionDefinition[];
}

/**
 * Whether an id is shaped like one we issued.
 *
 * Checked before the query, because Postgres errors on a failed uuid cast —
 * turning a malformed request into a server fault, and into a 500 body
 * describing the query that failed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const formService = {
  /**
   * The newest published version of one form, with its questions.
   *
   * Returns null rather than throwing, so the controller decides the status
   * code. Everything unavailable is **404, not 403** — a draft is a director's
   * work in progress, and telling an applicant one exists leaks that a
   * committee is preparing to recruit.
   */
  getPublishedForm: async (formId: string): Promise<PublishedForm | null> => {
    if (!UUID.test(formId)) {
      return null;
    }

    const [row] = await db
      .select({
        formId: form.id,
        kind: form.kind,
        title: form.title,
        description: form.description,
        cycleStatus: recruitmentCycle.status,
        cycleOpensAt: recruitmentCycle.opensAt,
        openingStatus: recruitmentOpening.status,
        openingOpensAt: recruitmentOpening.opensAt,
        versionId: formVersion.id,
        version: formVersion.version,
      })
      .from(form)
      .innerJoin(recruitmentCycle, eq(form.cycleId, recruitmentCycle.id))
      // Left, because a common form has no opening. An inner join would hide
      // every common form rather than gating committee ones.
      .leftJoin(recruitmentOpening, eq(form.openingId, recruitmentOpening.id))
      .innerJoin(
        formVersion,
        and(eq(formVersion.formId, form.id), eq(formVersion.status, "published")),
      )
      .where(eq(form.id, formId))
      // Newest published version wins. A form may have several, and a response
      // names the exact one it was answered against.
      .orderBy(desc(formVersion.version))
      .limit(1);

    if (!row) {
      return null;
    }
    // One clock reading for every comparison, so a form cannot be judged open
    // by the cycle and shut by the opening within the same request.
    const now = new Date();

    const cycleReadable =
      APPLICANT_VISIBLE_CYCLE_STATUSES.includes(
        row.cycleStatus as (typeof APPLICANT_VISIBLE_CYCLE_STATUSES)[number],
      ) && hasOpened(row.cycleOpensAt, now);
    if (!cycleReadable) {
      return null;
    }

    if (row.kind === "committee") {
      const openingReadable =
        APPLICANT_VISIBLE_OPENING_STATUSES.includes(
          row.openingStatus as (typeof APPLICANT_VISIBLE_OPENING_STATUSES)[number],
        ) && hasOpened(row.openingOpensAt, now);
      if (!openingReadable) {
        return null;
      }
    }

    const rows = await db
      .select({
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
      .where(eq(question.formVersionId, row.versionId))
      .orderBy(asc(question.position));

    return {
      formId: row.formId,
      kind: row.kind,
      title: row.title,
      description: row.description,
      version: row.version,
      // Row ids are deliberately absent. A browser has no use for one, and it
      // is one more thing to reason about if it ever reaches a URL or a log.
      questions: rows.map((q) => ({
        questionKey: q.questionKey,
        type: q.type,
        label: q.label,
        description: q.description,
        required: q.required,
        position: q.position,
        config: (q.configJson as QuestionConfig | null) ?? null,
        visibilityRule: (q.visibilityRuleJson as VisibilityRule | null) ?? null,
      })),
    };
  },
};
