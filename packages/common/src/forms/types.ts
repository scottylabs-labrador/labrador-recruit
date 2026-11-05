/**
 * The form vocabulary shared by the renderer, the builder, and the server.
 *
 * `packages/common` is pure — no database, no network, no environment — so
 * these types describe a form's *shape* rather than its storage. The database
 * rows in `@recruit/db` map onto them at the edges.
 */

/** A JSON value, which is what an answer can be. */
export type AnswerValue = string | number | boolean | string[] | null;

/** Answers keyed by `questionKey`, which is how both the browser and the server hold them. */
export type AnswerMap = Record<string, AnswerValue>;

export type QuestionType =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "dropdown"
  | "number"
  | "url"
  | "file_upload"
  | "section_heading"
  | "static_content";

/** Question types that never carry an answer and are never required. */
export const CONTENT_ONLY_TYPES: readonly QuestionType[] = ["section_heading", "static_content"];

export interface QuestionConfig {
  /** For the select types. */
  choices?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  placeholder?: string;
  helpText?: string;
  /** For `file_upload`. */
  allowedMimeTypes?: string[];
  maxSizeBytes?: number;
}

/**
 * A conditional visibility rule.
 *
 * **Structured data, never executable code.** A rule stored as code would have
 * to be run somewhere, and that somewhere would be a sandbox we then own — on
 * a system holding other students' application essays.
 *
 * The vocabulary is deliberately small and closed. It covers what recruitment
 * forms actually ask for, and nothing else. A general-purpose expression
 * language here would be a liability rather than a feature: every operator is
 * something the renderer and the validator both have to agree about exactly,
 * and something a director could use to make a form nobody can reason about.
 *
 * Decided in `docs/adr/0005-conditional-rule-format.md`.
 */
export type VisibilityRule =
  | { equals: { questionKey: string; value: AnswerValue } }
  | { notEquals: { questionKey: string; value: AnswerValue } }
  /** Membership in a multi-select answer. */
  | { includes: { questionKey: string; value: string } }
  /** Answered at all — present, not empty, not an empty selection. */
  | { answered: { questionKey: string } }
  | { greaterThan: { questionKey: string; value: number } }
  | { lessThan: { questionKey: string; value: number } }
  | { all: VisibilityRule[] }
  | { any: VisibilityRule[] }
  | { not: VisibilityRule };

export interface QuestionDefinition {
  questionKey: string;
  type: QuestionType;
  label: string;
  description?: string | null;
  required: boolean;
  /** Ordering, and the order rules are evaluated in. */
  position: number;
  config: QuestionConfig | null;
  visibilityRule: VisibilityRule | null;
}
