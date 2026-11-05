import type { AnswerMap, AnswerValue, QuestionDefinition } from "@recruit/common";
import { evaluateVisibility, validateAnswer } from "@recruit/common";
import { useState } from "react";

import { ReadonlyFileAnswer } from "@/components/forms/FileUploader";
import { QuestionField } from "@/components/forms/QuestionField";

export interface DynamicFormRendererProps {
  /** A published form version's questions. Rendered in `position` order. */
  questions: readonly QuestionDefinition[];
  answers: AnswerMap;
  /**
   * `readonly` renders answers as text with no controls at all.
   *
   * Used by the staff applicant-detail page. A disabled textarea with an essay
   * in it is unreadable, and a reviewer spends longer looking at this than
   * anybody else.
   */
  mode: "edit" | "readonly";
  onChange?: (questionKey: string, value: AnswerValue) => void;
  /**
   * Errors the server reported, keyed by question.
   *
   * Shown immediately rather than waiting for the field to be touched: a submit
   * already happened, so the applicant has seen the field and is looking for
   * what went wrong.
   */
  errors?: Record<string, string>;
}

/**
 * Renders a form from its question definitions.
 *
 * **One component, three surfaces**: the student application, the form
 * builder's preview, and the staff applicant-detail page. A lookalike for any
 * of them would drift, and the preview is the one that would mislead the person
 * relying on it most — a director checking what applicants will see.
 *
 * Visibility and validation both come from `@recruit/common`, which the server
 * also uses. That is the whole point of putting them there: the browser's copy
 * is a courtesy to the applicant, the server's is the rule, and sharing the
 * function is what stops them disagreeing.
 *
 * Deliberately **controlled** rather than built on React Hook Form, which
 * `docs/design.md` section 11 nominates. The page owns the answer state because
 * autosave and the `revision` conflict check need it, and RHF's resolver would
 * be a second validation path — exactly what Seam 2 and #18 exist to prevent.
 * RHF still fits the builder's settings panel in #25, which is a static form.
 */
export function DynamicFormRenderer({
  questions,
  answers,
  mode,
  onChange,
  errors,
}: DynamicFormRendererProps) {
  /**
   * Which fields the applicant has left.
   *
   * Validation messages wait for this. Scolding somebody about a field they
   * have not reached is hostile, and on a long form it paints the whole page
   * red before they have started.
   */
  const [touched, setTouched] = useState<Set<string>>(() => new Set());

  const visible = evaluateVisibility(questions, answers);
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      {ordered.map((question) => {
        if (!visible.has(question.questionKey)) {
          return null;
        }

        if (question.type === "section_heading") {
          return (
            <h2
              key={question.questionKey}
              className="border-b border-border pb-2 text-lg font-semibold"
            >
              {question.label}
            </h2>
          );
        }

        if (question.type === "static_content") {
          return (
            <div key={question.questionKey} className="space-y-1">
              <p className="text-sm font-medium text-foreground">{question.label}</p>
              {question.description ? (
                <p className="text-sm leading-6 text-muted-foreground">{question.description}</p>
              ) : null}
            </div>
          );
        }

        const value = answers[question.questionKey] ?? null;

        if (mode === "readonly") {
          return <ReadonlyAnswer key={question.questionKey} question={question} value={value} />;
        }

        return (
          /*
           * `aria-live` on the wrapper, because a conditional question
           * materialising mid-form is otherwise completely silent to somebody
           * using a screen reader — they would only find it by tabbing past
           * where they expected the next field to be.
           *
           * `polite` rather than `assertive`: it should be announced after the
           * change the applicant just made, not interrupt it.
           */
          <div key={question.questionKey} aria-live="polite">
            <QuestionField
              question={question}
              value={value}
              error={fieldError(question, value, touched, errors)}
              onChange={(next) => onChange?.(question.questionKey, next)}
              onBlur={() =>
                setTouched((previous) => {
                  if (previous.has(question.questionKey)) {
                    return previous;
                  }
                  const next = new Set(previous);
                  next.add(question.questionKey);
                  return next;
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The message to show for one field, or null for none.
 *
 * A server-reported error wins over a locally computed one: it is more specific,
 * it may describe something the browser cannot check, and the applicant is
 * already looking at the field because a submit sent them there.
 */
function fieldError(
  question: QuestionDefinition,
  value: AnswerValue,
  touched: Set<string>,
  errors?: Record<string, string>,
): string | null {
  const reported = errors?.[question.questionKey];
  if (reported) {
    return reported;
  }
  if (!touched.has(question.questionKey)) {
    return null;
  }
  const result = validateAnswer(question, value);
  return result.ok ? null : (result.message ?? "This answer is not acceptable.");
}

/**
 * One answer, as text.
 *
 * Says so explicitly when there is nothing. Blank space reads as a rendering
 * bug, and a reviewer needs to know the difference between "left this out" and
 * "the page failed to load it".
 */
function ReadonlyAnswer({ question, value }: { question: QuestionDefinition; value: AnswerValue }) {
  const text = formatAnswer(value);

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-muted-foreground">{question.label}</p>
      {/*
        A `file_upload` answer is an opaque file id, so the generic path below
        would show a uuid where somebody's resume should be - on the page whose
        entire job is reading back what they sent.
      */}
      {question.type === "file_upload" ? (
        typeof value === "string" && value !== "" ? (
          <ReadonlyFileAnswer fileId={value} />
        ) : (
          <p className="text-sm text-muted-foreground italic">No file attached</p>
        )
      ) : null}
      {question.type === "file_upload" ? null : text === null ? (
        <p className="text-sm text-muted-foreground italic">No answer given</p>
      ) : (
        // `whitespace-pre-wrap` so an essay's own paragraphs survive. Collapsing
        // them would make a long answer much harder to read than the applicant
        // intended.
        <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">{text}</p>
      )}
    </div>
  );
}

function formatAnswer(value: AnswerValue): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value.join(", ");
  }
  if (typeof value === "string") {
    return value.trim() === "" ? null : value;
  }
  return String(value);
}
