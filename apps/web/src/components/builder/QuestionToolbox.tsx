import type { QuestionDefinition } from "@recruit/common";

import { Button } from "@/components/ui/button.tsx";

/**
 * The ten question types, in a director's words rather than ours.
 *
 * `single_select` means nothing to somebody who has only ever filled in a
 * form; "multiple choice" does. The key is what the API and the renderer use
 * and never appears here.
 *
 * All ten are offered, because the toolbox is the only way to add a question —
 * a type missing from this list is a type nobody can use.
 */
const TYPES: readonly { type: QuestionDefinition["type"]; label: string; hint: string }[] = [
  { type: "short_text", label: "Short answer", hint: "A line of text" },
  { type: "long_text", label: "Long answer", hint: "A paragraph or an essay" },
  { type: "single_select", label: "Multiple choice", hint: "Pick exactly one" },
  { type: "multi_select", label: "Checkboxes", hint: "Pick any number" },
  { type: "dropdown", label: "Dropdown", hint: "Pick one from a long list" },
  { type: "number", label: "Number", hint: "A year, a count" },
  { type: "url", label: "Link", hint: "A portfolio or a GitHub profile" },
  { type: "file_upload", label: "File upload", hint: "A PDF, PNG or JPEG" },
  { type: "section_heading", label: "Section heading", hint: "Breaks a long form up" },
  { type: "static_content", label: "Description", hint: "Text with no answer" },
];

export function QuestionToolbox({
  onAdd,
  disabled,
}: {
  onAdd: (type: QuestionDefinition["type"]) => void;
  disabled: boolean;
}) {
  return (
    <section aria-labelledby="toolbox" className="space-y-2">
      <h2 id="toolbox" className="text-sm font-semibold">
        Add a question
      </h2>
      <ul className="space-y-1">
        {TYPES.map((entry) => (
          <li key={entry.type}>
            <Button
              variant="outline"
              /*
               * The accessible name is the type, not the type plus its hint.
               * Otherwise "Checkboxes — pick any number" answers to "number"
               * as readily as the Number button does, which is ambiguous for
               * a screen reader user and was ambiguous for the test too.
               */
              aria-label={entry.label}
              className="h-auto w-full justify-start px-3 py-2 text-left"
              disabled={disabled}
              onClick={() => onAdd(entry.type)}
            >
              <span className="block">
                <span className="block text-sm font-medium">{entry.label}</span>
                <span className="block text-xs text-muted-foreground">{entry.hint}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
