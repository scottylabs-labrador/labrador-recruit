import { CONTENT_ONLY_TYPES } from "./types.ts";
import type { AnswerMap, AnswerValue, QuestionDefinition } from "./types.ts";
import { evaluateVisibility } from "./visibility.ts";

export interface AnswerResult {
  ok: boolean;
  /** Present when `ok` is false. Written for the applicant, not for a log. */
  message?: string;
}

export interface ResponseResult {
  ok: boolean;
  /** Keys of required, visible questions with no answer. */
  missing: string[];
  /** Answers that are present but not acceptable. */
  invalid: { questionKey: string; message: string }[];
  /**
   * The answers to actually store: visible questions only.
   *
   * An answer to a question that ended up hidden is dropped rather than carried
   * through. The applicant changed an earlier answer so the question
   * disappeared; submitting the orphan would put text in front of a reviewer
   * that the applicant believes they removed.
   */
  answers: AnswerMap;
}

const URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Whether one answer is acceptable for one question.
 *
 * Runs in the browser so a student sees the problem as they type, and on the
 * server where it is enforced. The browser's copy is a courtesy; the server's is
 * the rule. Sharing the function is what stops them disagreeing.
 *
 * No coercion anywhere. `"2028"` arriving where a number belongs means a client
 * sent the wrong shape, and guessing is precisely the kind of thing two copies
 * of a validator come to do differently.
 */
export function validateAnswer(question: QuestionDefinition, value: AnswerValue): AnswerResult {
  const contentOnly = CONTENT_ONLY_TYPES.includes(question.type);
  const empty = isEmpty(value);

  if (contentOnly) {
    // A heading carries no answer. One arriving means a client is sending data
    // for a field that does not exist, and storing it would create an answer no
    // screen can display.
    return empty ? { ok: true } : { ok: false, message: "This question does not take an answer." };
  }

  if (empty) {
    return question.required ? { ok: false, message: "This question is required." } : { ok: true };
  }

  const config = question.config ?? {};

  switch (question.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") {
        return { ok: false, message: "Expected text." };
      }
      // Trimmed, so trailing spaces cannot pad a short answer past a minimum.
      const length = value.trim().length;
      if (config.minLength !== undefined && length < config.minLength) {
        return { ok: false, message: `Please write at least ${config.minLength} characters.` };
      }
      if (config.maxLength !== undefined && length > config.maxLength) {
        return { ok: false, message: `Please keep this under ${config.maxLength} characters.` };
      }
      return { ok: true };
    }

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, message: "Expected a number." };
      }
      if (config.minimum !== undefined && value < config.minimum) {
        return { ok: false, message: `Must be ${config.minimum} or more.` };
      }
      if (config.maximum !== undefined && value > config.maximum) {
        return { ok: false, message: `Must be ${config.maximum} or less.` };
      }
      return { ok: true };
    }

    case "single_select":
    case "dropdown": {
      if (typeof value !== "string") {
        return { ok: false, message: "Expected one choice." };
      }
      if (config.choices && !config.choices.includes(value)) {
        return { ok: false, message: "That is not one of the available choices." };
      }
      return { ok: true };
    }

    case "multi_select": {
      if (!Array.isArray(value)) {
        return { ok: false, message: "Expected a list of choices." };
      }
      if (config.choices) {
        const offered = new Set(config.choices);
        const unknown = value.filter((entry) => !offered.has(entry));
        if (unknown.length > 0) {
          return { ok: false, message: "That is not one of the available choices." };
        }
      }
      return { ok: true };
    }

    case "url": {
      if (typeof value !== "string") {
        return { ok: false, message: "Expected a link." };
      }
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return { ok: false, message: "Enter a full link, starting with https://" };
      }
      // Scheme allow-list, not a pattern. A stored `javascript:` or `data:` URL
      // rendered as a link on a reviewer's screen later is how a form becomes a
      // delivery mechanism.
      if (!URL_SCHEMES.has(parsed.protocol)) {
        return { ok: false, message: "Links must start with http:// or https://" };
      }
      return { ok: true };
    }

    case "file_upload": {
      if (typeof value !== "string") {
        return { ok: false, message: "Expected an uploaded file." };
      }
      // The reference is a file id. Whether it is committed and owned by this
      // applicant is checked against the database at submission — `common` is
      // pure and cannot know.
      return { ok: true };
    }

    default:
      return { ok: true };
  }
}

/**
 * Whether a whole response may be submitted, and what to store.
 *
 * Only **visible** questions are required, using the same evaluator the renderer
 * uses. Demanding an answer to a hidden question would block a submission on
 * something the applicant was never shown — the worst failure available here,
 * because nothing on screen explains it.
 *
 * Every problem is reported, not just the first. A student with forty questions
 * and one message per submit will submit forty times.
 */
export function validateResponse(
  questions: readonly QuestionDefinition[],
  answers: AnswerMap,
): ResponseResult {
  const visible = evaluateVisibility(questions, answers);
  const missing: string[] = [];
  const invalid: { questionKey: string; message: string }[] = [];
  const kept: AnswerMap = {};

  for (const question of [...questions].sort((a, b) => a.position - b.position)) {
    if (!visible.has(question.questionKey)) {
      continue;
    }
    if (CONTENT_ONLY_TYPES.includes(question.type)) {
      // `required: true` on a heading is a misconfiguration, not an instruction.
      continue;
    }

    const value = answers[question.questionKey] ?? null;

    if (isEmpty(value)) {
      if (question.required) {
        missing.push(question.questionKey);
      }
      continue;
    }

    const result = validateAnswer(question, value);
    if (result.ok) {
      kept[question.questionKey] = value;
    } else {
      invalid.push({
        questionKey: question.questionKey,
        message: result.message ?? "This answer is not acceptable.",
      });
    }
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    answers: kept,
  };
}

function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}
