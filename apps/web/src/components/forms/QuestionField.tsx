import type { AnswerValue, QuestionDefinition } from "@recruit/common";

import {
  Checkbox,
  FieldError,
  FieldHint,
  Input,
  Label,
  Radio,
  Select,
  Textarea,
} from "@/components/ui/field";

export interface QuestionFieldProps {
  question: QuestionDefinition;
  value: AnswerValue;
  /** Shown immediately. Null while the field has not been touched and the server has said nothing. */
  error: string | null;
  onChange: (value: AnswerValue) => void;
  onBlur: () => void;
}

/**
 * One question, as a control.
 *
 * Every control is a **native element**. That is not nostalgia: it means the
 * browser's own label association, required semantics, keyboard behaviour, and
 * form validation announcements come for free and correctly, on every assistive
 * technology, without us reimplementing any of it. A custom listbox would be
 * more work and worse.
 */
export function QuestionField({ question, value, error, onChange, onBlur }: QuestionFieldProps) {
  const controlId = `q-${question.questionKey}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const choices = question.config?.choices ?? [];

  // Help text and the error are both announced, so both are referenced. Order
  // matters: a screen reader reads them in the order given, and the error is
  // the more urgent of the two.
  const describedBy =
    [error ? errorId : null, question.description ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  const shared = {
    id: controlId,
    "aria-required": question.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onBlur,
  };

  function control() {
    switch (question.type) {
      case "long_text":
        return (
          <Textarea
            {...shared}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      case "number":
        return (
          <Input
            {...shared}
            type="number"
            inputMode="numeric"
            value={typeof value === "number" ? String(value) : ""}
            onChange={(event) => {
              // Report a number, not a string. The shared validator refuses a
              // string where a number belongs — deliberately, so the two
              // validators cannot drift — and sending text would make the form
              // unsubmittable with nothing on screen to explain why.
              const next = event.target.value;
              onChange(next === "" ? null : Number(next));
            }}
          />
        );

      case "url":
        return (
          <Input
            {...shared}
            type="url"
            inputMode="url"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      case "dropdown":
        return (
          <Select
            {...shared}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">Choose one</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </Select>
        );

      case "single_select":
        // Radios rather than a select, because a short exclusive list is easier
        // to compare when every option is visible at once. A `fieldset` carries
        // the group's label, which a bare set of radios would not have.
        return (
          <fieldset
            className="mt-1 space-y-1.5"
            aria-required={question.required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          >
            <legend className="sr-only">{question.label}</legend>
            {choices.map((choice) => (
              <label key={choice} className="flex items-center gap-2 text-sm">
                <Radio
                  name={controlId}
                  value={choice}
                  checked={value === choice}
                  onChange={() => onChange(choice)}
                  onBlur={onBlur}
                />
                {choice}
              </label>
            ))}
          </fieldset>
        );

      case "multi_select": {
        const selected = Array.isArray(value) ? value : [];
        return (
          <fieldset
            className="mt-1 space-y-1.5"
            aria-required={question.required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          >
            <legend className="sr-only">{question.label}</legend>
            {choices.map((choice) => (
              <label key={choice} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(choice)}
                  onChange={(event) => {
                    // Rebuilt in the form's own choice order rather than click
                    // order, so two applicants who picked the same options
                    // produce the same stored answer.
                    const next = event.target.checked
                      ? choices.filter((c) => c === choice || selected.includes(c))
                      : selected.filter((c) => c !== choice);
                    onChange(next);
                  }}
                  onBlur={onBlur}
                />
                {choice}
              </label>
            ))}
          </fieldset>
        );
      }

      case "file_upload":
        // TODO(track-a): #21 replaces this with FileUploader, which exchanges
        // the file for a committed `file` id. Until then the control is absent
        // rather than a text box that looks like it works.
        return <FieldHint>Uploads are not available yet.</FieldHint>;

      case "short_text":
      default:
        return (
          <Input
            {...shared}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  }

  const grouped = question.type === "single_select" || question.type === "multi_select";

  return (
    <div className="space-y-1.5">
      {/*
        A group's label is the fieldset's legend, so rendering a `label` that
        points at a fieldset would be a broken association. For everything else
        `htmlFor` is what makes clicking the text focus the control.
      */}
      {grouped ? (
        <p className="text-sm font-medium text-foreground">
          {question.label}
          {question.required ? <RequiredMark /> : null}
        </p>
      ) : (
        <Label htmlFor={controlId}>
          {question.label}
          {question.required ? <RequiredMark /> : null}
        </Label>
      )}

      {question.description ? <FieldHint id={hintId}>{question.description}</FieldHint> : null}

      {control()}

      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

/**
 * Required, in words.
 *
 * An asterisk alone is a convention somebody has to already know, and a colour
 * alone is invisible to a good proportion of applicants. The word is in the
 * accessible name either way.
 */
function RequiredMark() {
  return <span className="ml-1 text-sm font-normal text-muted-foreground">(required)</span>;
}
