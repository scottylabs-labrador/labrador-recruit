import type { QuestionConfig, QuestionDefinition, VisibilityRule } from "@recruit/common";
import { CONTENT_ONLY_TYPES } from "@recruit/common";
import { useEffect, useState } from "react";

import { ConditionalRuleEditor } from "@/components/builder/ConditionalRuleEditor.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox, FieldHint, Input, Label, Textarea } from "@/components/ui/field";

/** The types whose answers come from a list the director writes. */
const CHOICE_TYPES: readonly QuestionDefinition["type"][] = [
  "single_select",
  "multi_select",
  "dropdown",
];

export interface QuestionSettingsProps {
  question: QuestionDefinition;
  /** Questions earlier in position order, which a rule may depend on. */
  earlier: readonly QuestionDefinition[];
  onSave: (next: QuestionDefinition) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  isSaving: boolean;
}

/**
 * One question's settings.
 *
 * Explicitly saved rather than saved on every keystroke. A question's settings
 * are interdependent — changing a type can invalidate its choices, and a rule
 * depends on another question's — so a half-applied change is a form in a state
 * the director did not ask for. The canvas shows what is saved; this panel
 * shows what is being edited.
 *
 * Which fields appear depends on the type, because a placeholder on a section
 * heading or a choice list on an essay are controls that cannot do anything.
 */
export function QuestionSettings(props: QuestionSettingsProps) {
  const [draft, setDraft] = useState<QuestionDefinition>(props.question);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
   * Reset when a different question is selected.
   *
   * Keyed on the question key rather than the object, so re-rendering the same
   * question does not discard what is being typed into it.
   */
  useEffect(() => {
    setDraft(props.question);
    setConfirmingDelete(false);
  }, [props.question]);

  const contentOnly = CONTENT_ONLY_TYPES.includes(draft.type);
  const choices = draft.config?.choices ?? [];

  function patchConfig(next: Partial<QuestionConfig>) {
    setDraft((current) => ({ ...current, config: { ...current.config, ...next } }));
  }

  return (
    <section aria-labelledby="settings" className="space-y-4">
      <h2 id="settings" className="text-sm font-semibold">
        Question settings
      </h2>

      <div className="space-y-1">
        <Label htmlFor="setting-label">Question text</Label>
        <Textarea
          id="setting-label"
          rows={2}
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="setting-description">Help text</Label>
        <Textarea
          id="setting-description"
          rows={2}
          value={draft.description ?? ""}
          onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
        />
        <FieldHint>Shown under the question. Use it for anything an applicant might ask.</FieldHint>
      </div>

      {/*
        A heading carries no answer, so `required` on it is a misconfiguration
        rather than an instruction — nothing could satisfy it and the form
        would be unsubmittable. The server normalises it away; not offering the
        control is how the director never has to find that out.
      */}
      {contentOnly ? null : (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.required}
            onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
          />
          Required
        </label>
      )}

      {contentOnly || CHOICE_TYPES.includes(draft.type) ? null : (
        <div className="space-y-1">
          <Label htmlFor="setting-placeholder">Placeholder</Label>
          <Input
            id="setting-placeholder"
            value={draft.config?.placeholder ?? ""}
            onChange={(event) => patchConfig({ placeholder: event.target.value || undefined })}
          />
        </div>
      )}

      {draft.type === "long_text" || draft.type === "short_text" ? (
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="setting-min">Shortest allowed</Label>
            <Input
              id="setting-min"
              type="number"
              value={draft.config?.minLength ?? ""}
              onChange={(event) =>
                patchConfig({
                  minLength: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="setting-max">Longest allowed</Label>
            <Input
              id="setting-max"
              type="number"
              value={draft.config?.maxLength ?? ""}
              onChange={(event) =>
                patchConfig({
                  maxLength: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
        </div>
      ) : null}

      {CHOICE_TYPES.includes(draft.type) ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Answer choices</p>
          {choices.map((choice, index) => (
            // Indexed keys, because the choices are an ordered list a director
            // edits in place and two of them may legitimately read the same
            // while being typed.
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} className="flex items-center gap-2">
              <Label htmlFor={`choice-${index}`} className="sr-only">
                {`Choice ${index + 1}`}
              </Label>
              <Input
                id={`choice-${index}`}
                value={choice}
                onChange={(event) => {
                  const next = [...choices];
                  next[index] = event.target.value;
                  patchConfig({ choices: next });
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patchConfig({ choices: choices.filter((_, at) => at !== index) })}
              >
                {`Remove choice ${index + 1}`}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => patchConfig({ choices: [...choices, ""] })}
          >
            Add a choice
          </Button>
          {choices.length === 0 ? (
            <FieldHint>
              A choice question with no choices cannot be answered, and the form cannot be published
              until it has at least one.
            </FieldHint>
          ) : null}
        </div>
      ) : null}

      {draft.type === "file_upload" ? (
        <FieldHint>
          Applicants may upload a PDF, PNG or JPEG, up to 10MB. The file type is checked from the
          file&rsquo;s own contents, not its name.
        </FieldHint>
      ) : null}

      {contentOnly ? null : (
        <div className="space-y-1">
          <p className="text-sm font-medium">When to show this question</p>
          <ConditionalRuleEditor
            candidates={props.earlier}
            value={draft.visibilityRule}
            onChange={(rule: VisibilityRule | null) => setDraft({ ...draft, visibilityRule: rule })}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button disabled={props.isSaving} onClick={() => props.onSave(draft)}>
          {props.isSaving ? "Saving…" : "Save question"}
        </Button>
        <Button variant="outline" size="sm" onClick={props.onDuplicate}>
          Duplicate
        </Button>
        {confirmingDelete ? null : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
            Delete this question
          </Button>
        )}
      </div>

      {/*
        Asked twice, because a question takes a while to write and there is no
        undo. Inline rather than a `window.confirm`, which is unstyleable and
        blocks the page.
      */}
      {confirmingDelete ? (
        <div className="rounded-[8px] border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium">Delete this question?</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Any conditional rule that depends on it will stop the form publishing until you fix it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="destructive" size="sm" onClick={props.onDelete}>
              Yes, delete it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
