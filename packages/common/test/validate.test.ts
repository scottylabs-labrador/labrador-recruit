/**
 * Answer validation.
 *
 * The same pair of functions runs in the browser, so a student sees the problem
 * as they type, and on the server, where it is actually enforced. The browser's
 * copy is a courtesy; the server's is the rule.
 */
import { describe, expect, it } from "vitest";

import type { QuestionDefinition, QuestionType } from "../src/forms/types.ts";
import { validateAnswer, validateResponse } from "../src/forms/validate.ts";

function q(
  questionKey: string,
  type: QuestionType,
  overrides: Partial<QuestionDefinition> = {},
): QuestionDefinition {
  return {
    questionKey,
    type,
    label: questionKey,
    required: false,
    position: 1,
    config: null,
    visibilityRule: null,
    ...overrides,
  };
}

describe("validateAnswer", () => {
  it("accepts text within its length bounds", () => {
    const question = q("why", "long_text", { config: { minLength: 5, maxLength: 20 } });

    expect(validateAnswer(question, "because I would like to").ok).toBe(false);
    expect(validateAnswer(question, "because").ok).toBe(true);
  });

  it("rejects text below the minimum length", () => {
    const question = q("why", "long_text", { config: { minLength: 10 } });

    const result = validateAnswer(question, "short");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least 10/i);
  });

  it("measures length after trimming, so spaces do not pad a short answer", () => {
    const question = q("why", "long_text", { config: { minLength: 10 } });

    expect(validateAnswer(question, "short     ").ok).toBe(false);
  });

  it("rejects a number outside its range", () => {
    const question = q("year", "number", { config: { minimum: 2026, maximum: 2032 } });

    expect(validateAnswer(question, 2025).ok).toBe(false);
    expect(validateAnswer(question, 2028).ok).toBe(true);
  });

  it("rejects a non-numeric answer to a number question", () => {
    const question = q("year", "number");

    // No coercion. "2028" arriving where a number belongs means a client sent
    // the wrong shape, and accepting it would let the two validators differ.
    expect(validateAnswer(question, "2028").ok).toBe(false);
  });

  it("rejects a choice that is not on offer", () => {
    const question = q("area", "single_select", { config: { choices: ["Software", "Design"] } });

    expect(validateAnswer(question, "Finance").ok).toBe(false);
    expect(validateAnswer(question, "Design").ok).toBe(true);
  });

  it("rejects a multi-select containing a choice that is not on offer", () => {
    const question = q("langs", "multi_select", { config: { choices: ["Go", "Rust"] } });

    expect(validateAnswer(question, ["Go", "Malbolge"]).ok).toBe(false);
    expect(validateAnswer(question, ["Go", "Rust"]).ok).toBe(true);
  });

  it("rejects a single value where a multi-select is expected", () => {
    const question = q("langs", "multi_select", { config: { choices: ["Go"] } });

    expect(validateAnswer(question, "Go").ok).toBe(false);
  });

  it("accepts an http or https URL and rejects anything else", () => {
    const question = q("github", "url");

    expect(validateAnswer(question, "https://github.com/example").ok).toBe(true);
    expect(validateAnswer(question, "http://example.com").ok).toBe(true);
    expect(validateAnswer(question, "github.com/example").ok).toBe(false);
    // Not a transport. A stored `javascript:` URL rendered as a link later is
    // the kind of thing that turns a form into a delivery mechanism.
    expect(validateAnswer(question, "javascript:alert(1)").ok).toBe(false);
    expect(validateAnswer(question, "data:text/html,<script>").ok).toBe(false);
  });

  it("accepts an empty answer to an optional question", () => {
    const question = q("github", "url", { required: false });

    expect(validateAnswer(question, "").ok).toBe(true);
    expect(validateAnswer(question, null).ok).toBe(true);
  });

  it("rejects an empty answer to a required question", () => {
    const question = q("why", "long_text", { required: true });

    expect(validateAnswer(question, "").ok).toBe(false);
    expect(validateAnswer(question, "   ").ok).toBe(false);
    expect(validateAnswer(question, null).ok).toBe(false);
  });

  it("rejects any answer to a content-only question", () => {
    const heading = q("section-a", "section_heading", { required: false });

    // A heading carries no answer. One arriving means a client is sending data
    // for a field that does not exist, and storing it would create an answer no
    // screen can display.
    expect(validateAnswer(heading, "something").ok).toBe(false);
    expect(validateAnswer(heading, null).ok).toBe(true);
  });
});

describe("validateResponse", () => {
  const area = q("area", "single_select", {
    position: 1,
    required: true,
    config: { choices: ["AI", "Design"] },
  });
  const aiProject = q("ai-project", "long_text", {
    position: 2,
    required: true,
    visibilityRule: { equals: { questionKey: "area", value: "AI" } },
  });
  const motivation = q("motivation", "long_text", { position: 3, required: true });

  it("accepts a complete response", () => {
    const result = validateResponse([area, aiProject, motivation], {
      area: "AI",
      "ai-project": "A classifier.",
      motivation: "I would like to build things.",
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports every missing required answer, not just the first", () => {
    const result = validateResponse([area, aiProject, motivation], {});

    // A student with forty questions and one error message per submit will
    // submit forty times. Report them all.
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("area");
    expect(result.missing).toContain("motivation");
  });

  it("does not require a question that is hidden", () => {
    const result = validateResponse([area, aiProject, motivation], {
      area: "Design",
      motivation: "I would like to build things.",
    });

    // `ai-project` is required *and* hidden. Demanding it would block a
    // submission on a question the applicant was never shown — the worst
    // possible failure, because nothing on screen explains it.
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("excludes an answer to a hidden question from the submission", () => {
    const result = validateResponse([area, aiProject, motivation], {
      area: "Design",
      "ai-project": "stale answer from before they changed their mind",
      motivation: "I would like to build things.",
    });

    // The applicant answered, then changed the earlier answer so the question
    // disappeared. Submitting the orphaned text would put something in front of
    // a reviewer that the applicant believes they removed.
    expect(result.ok).toBe(true);
    expect(Object.keys(result.answers)).not.toContain("ai-project");
    expect(Object.keys(result.answers)).toContain("motivation");
  });

  it("reports an invalid answer as well as a missing one", () => {
    const result = validateResponse([area, motivation], {
      area: "Finance",
      motivation: "",
    });

    expect(result.ok).toBe(false);
    expect(result.invalid.map((entry) => entry.questionKey)).toContain("area");
    expect(result.missing).toContain("motivation");
  });

  it("ignores an answer to a question that is not on the form", () => {
    const result = validateResponse([motivation], {
      motivation: "I would like to build things.",
      "not-a-question": "injected",
    });

    // A client can send anything. Only what the form defines is carried through.
    expect(result.ok).toBe(true);
    expect(Object.keys(result.answers)).toEqual(["motivation"]);
  });

  it("does not require content-only questions", () => {
    const heading = q("section-a", "section_heading", { position: 1, required: true });

    const result = validateResponse([heading, motivation], {
      motivation: "I would like to build things.",
    });

    // `required: true` on a heading is a misconfiguration, not an instruction.
    expect(result.ok).toBe(true);
  });
});
