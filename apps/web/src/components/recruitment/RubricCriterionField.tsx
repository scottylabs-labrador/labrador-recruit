import type { RubricCriterionSummary } from "@/lib/recruitment.ts";

interface RubricCriterionFieldProps {
  criterion: RubricCriterionSummary;
  value: number | undefined;
  disabled: boolean;
  invalid: boolean;
  onChange: (score: number) => void;
}

/**
 * One rubric criterion as a native radio group.
 *
 * `fieldset` + `legend` names the group for assistive technology, and native
 * radios give roving-arrow-key selection for free, so a reviewer can score an
 * entire rubric from the keyboard alone.
 */
export function RubricCriterionField({
  criterion,
  value,
  disabled,
  invalid,
  onChange,
}: RubricCriterionFieldProps) {
  const descriptionId = `criterion-${criterion.key}-description`;
  const options: number[] = [];
  for (let score = criterion.minScore; score <= criterion.maxScore; score += 1) {
    options.push(score);
  }

  return (
    <fieldset
      className="flex flex-col gap-1.5"
      aria-describedby={criterion.description === null ? undefined : descriptionId}
      aria-invalid={invalid || undefined}
    >
      <legend className="text-sm font-medium text-foreground">{criterion.label}</legend>
      {criterion.description === null ? null : (
        <p id={descriptionId} className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {criterion.description}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((score) => {
          const inputId = `criterion-${criterion.key}-${score}`;
          const selected = value === score;
          return (
            <label
              key={score}
              htmlFor={inputId}
              className={[
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                selected
                  ? "border-primary bg-primary text-primary-foreground font-semibold"
                  : "border-input bg-background hover:bg-muted",
                disabled ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <input
                id={inputId}
                type="radio"
                name={`criterion-${criterion.key}`}
                value={score}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(score)}
                className="sr-only"
              />
              {score}
            </label>
          );
        })}
      </div>
      {invalid ? (
        <p className="text-sm font-medium text-destructive">
          Score this criterion before submitting.
        </p>
      ) : null}
    </fieldset>
  );
}
