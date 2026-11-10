import type { QuestionDefinition, VisibilityRule } from "@recruit/common";

import { Button } from "@/components/ui/button.tsx";
import { Checkbox, Input, Label, Select } from "@/components/ui/field";

/**
 * The operators a director can pick, and what they mean in plain words.
 *
 * A subset of `VisibilityRule`'s nine, deliberately: these six each depend on
 * exactly one earlier question, which is what this editor's shape can express.
 * `all`, `any` and `not` combine rules and would need a nested editor; a form
 * needing one is rare enough that it is better absent than half-built.
 */
const OPERATORS = [
  { value: "equals", label: "is exactly" },
  { value: "notEquals", label: "is anything except" },
  { value: "includes", label: "includes" },
  { value: "answered", label: "has been answered at all" },
  { value: "greaterThan", label: "is more than" },
  { value: "lessThan", label: "is less than" },
] as const;

type Operator = (typeof OPERATORS)[number]["value"];

export interface ConditionalRuleEditorProps {
  /** Only questions **earlier** in position order. See the comment below. */
  candidates: readonly QuestionDefinition[];
  value: VisibilityRule | null;
  onChange: (rule: VisibilityRule | null) => void;
}

interface Parsed {
  operator: Operator | null;
  questionKey: string;
  value: string;
  /** True when the stored rule is real but beyond what this editor can show. */
  unsupported: boolean;
}

/** Reads the one dependency and operator out of a stored rule, if it has one. */
function parse(rule: VisibilityRule | null): Parsed {
  if (rule === null) {
    return { operator: null, questionKey: "", value: "", unsupported: false };
  }

  for (const { value: operator } of OPERATORS) {
    if (operator in rule) {
      const body = (rule as Record<string, { questionKey: string; value?: unknown }>)[operator]!;
      const raw = body.value;

      /*
       * Narrowed to a scalar on the way in, not out of one on the way past.
       *
       * `equals` accepts a `string[]` — "answered exactly these choices" is a
       * meaningful rule — and this editor has one input, so it cannot show
       * one. Stringifying the array would be lossy in a way that *looks*
       * fine, so it is reported as unsupported instead. Checking positively
       * for the shapes that work is also the only version the typechecker can
       * follow: a negative check leaves `unknown` as `unknown`.
       */
      if (raw === undefined || raw === null) {
        return { operator, questionKey: body.questionKey, value: "", unsupported: false };
      }
      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return {
          operator,
          questionKey: body.questionKey,
          value: String(raw),
          unsupported: false,
        };
      }
      return { operator: null, questionKey: body.questionKey, value: "", unsupported: true };
    }
  }

  /*
   * `all`, `any`, `not`, or a shape from a future version.
   *
   * Reported rather than silently dropped. Showing the editor's defaults over
   * the top of it would mean the next save quietly replaced a rule somebody
   * wrote deliberately — and they would have no way to know it had happened.
   */
  return { operator: null, questionKey: "", value: "", unsupported: true };
}

function build(operator: Operator, questionKey: string, raw: string): VisibilityRule | null {
  if (questionKey === "") {
    return null;
  }
  switch (operator) {
    case "answered":
      return { answered: { questionKey } };
    case "includes":
      return { includes: { questionKey, value: raw } };
    case "greaterThan":
    case "lessThan": {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return operator === "greaterThan"
        ? { greaterThan: { questionKey, value: numeric } }
        : { lessThan: { questionKey, value: numeric } };
    }
    case "notEquals":
      return { notEquals: { questionKey, value: raw } };
    default:
      return { equals: { questionKey, value: raw } };
  }
}

/**
 * Builds a `VisibilityRule` as **structured data**.
 *
 * The shape is the contract: `question.visibility_rule_json` round-trips
 * through this editor, `DynamicFormRenderer`, and the server's publish check,
 * all reading the same closed union from
 * [ADR 0005](../../../../docs/adr/0005-conditional-rule-format.md). A rule
 * written in the builder's own shape would evaluate differently in the one
 * place that decides whether an applicant sees a question.
 *
 * **Only earlier questions are offered.** `evaluateVisibility` is a single pass
 * in position order, so a rule depending on a later answer can never be
 * satisfied — the question would be permanently hidden and the director would
 * have no idea why. #17 refuses it at publish; preventing it here means it
 * cannot be written at all, which is a better place to catch it than an error
 * message.
 */
export function ConditionalRuleEditor(props: ConditionalRuleEditorProps) {
  const parsed = parse(props.value);
  const enabled = props.value !== null;
  const dependency = props.candidates.find((row) => row.questionKey === parsed.questionKey);
  const choices = dependency?.config?.choices ?? [];
  const operator = parsed.operator ?? "equals";

  if (props.candidates.length === 0) {
    return (
      <div className="rounded-[8px] border border-border bg-muted/40 p-3">
        <p className="text-sm leading-6 text-muted-foreground">
          This question can only depend on an answer that comes before it, and nothing does yet.
          Move it after another question to make it conditional.
        </p>
      </div>
    );
  }

  if (parsed.unsupported) {
    return (
      <div className="rounded-[8px] border border-border bg-muted/40 p-3">
        <p className="text-sm leading-6">
          This question has a rule more complex than this editor can show.
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          It is still in effect and still checked when you publish. Removing it here is the only
          change this panel can make to it.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => props.onChange(null)}>
          Remove the rule
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={enabled}
          onChange={(event) => {
            props.onChange(
              event.target.checked ? build("equals", props.candidates[0]!.questionKey, "") : null,
            );
          }}
        />
        Only show this question sometimes
      </label>

      {!enabled ? null : (
        <div className="space-y-2 rounded-[8px] border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="rule-depends-on">Depends on</Label>
            <Select
              id="rule-depends-on"
              value={parsed.questionKey}
              onChange={(event) =>
                props.onChange(build(operator, event.target.value, parsed.value))
              }
            >
              {props.candidates.map((row) => (
                <option key={row.questionKey} value={row.questionKey}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-operator">When the answer</Label>
            <Select
              id="rule-operator"
              value={operator}
              onChange={(event) =>
                props.onChange(
                  build(event.target.value as Operator, parsed.questionKey, parsed.value),
                )
              }
            >
              {OPERATORS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>

          {/* `answered` takes no value, so offering an empty box would invite
              somebody to fill in something that is ignored. */}
          {operator === "answered" ? null : (
            <div className="space-y-1">
              <Label htmlFor="rule-value">The value</Label>
              {choices.length > 0 ? (
                <Select
                  id="rule-value"
                  value={parsed.value}
                  onChange={(event) =>
                    props.onChange(build(operator, parsed.questionKey, event.target.value))
                  }
                >
                  <option value="">Choose one</option>
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="rule-value"
                  value={parsed.value}
                  onChange={(event) =>
                    props.onChange(build(operator, parsed.questionKey, event.target.value))
                  }
                />
              )}
              {/*
                Choice drift is refused at publish, so saying it here saves a
                director discovering it later: a rule written against a choice
                somebody then removes leaves the question permanently hidden.
              */}
              {choices.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  If this choice is removed later, the form cannot be published until the rule is
                  fixed.
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
