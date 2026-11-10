import type { QuestionDefinition } from "@recruit/common";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";

export interface FormCanvasProps {
  questions: readonly QuestionDefinition[];
  selectedKey: string | null;
  onSelect: (questionKey: string) => void;
  onMove: (questionKey: string, direction: -1 | 1) => void;
  isBusy: boolean;
}

/** The director's word for a type, matching the toolbox. */
const TYPE_LABELS: Record<QuestionDefinition["type"], string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  single_select: "Multiple choice",
  multi_select: "Checkboxes",
  dropdown: "Dropdown",
  number: "Number",
  url: "Link",
  file_upload: "File upload",
  section_heading: "Section heading",
  static_content: "Description",
};

/**
 * The ordered question list.
 *
 * **Move buttons, not only a drag handle.** #25 names `dnd-kit`, and dragging
 * is the nicest way to do this for most people — but a reorder that can *only*
 * be dragged cannot be done at all by somebody not using a pointer, and
 * position here decides both the display order and the order visibility rules
 * are evaluated in. So the keyboard path is a real control rather than a
 * fallback. Each button names its question, so the label still means something
 * read on its own out of a list of controls.
 *
 * Each row is a button rather than a div with a click handler: selecting a
 * question is a real action, and the browser's own focus and keyboard handling
 * come free.
 */
export function FormCanvas(props: FormCanvasProps) {
  const ordered = [...props.questions].sort((a, b) => a.position - b.position);

  if (ordered.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No questions yet. Pick a type from the left to add the first one.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {ordered.map((question, index) => {
        const selected = props.selectedKey === question.questionKey;
        return (
          <li
            key={question.questionKey}
            className={`flex items-start gap-2 rounded-[10px] border bg-card p-3 ${
              selected ? "border-primary" : "border-border"
            }`}
          >
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              /*
               * Named "Edit X" rather than just "X".
               *
               * The row sits between a "Move X up" and a "Move X down", so a
               * bare label answers to the same words as both of its
               * neighbours - ambiguous to anybody picking a control by name,
               * which includes a screen reader user and a test.
               */
              aria-label={`Edit ${question.label.trim() === "" ? "Untitled question" : question.label}`}
              className="min-w-0 flex-1 text-left"
              onClick={() => props.onSelect(question.questionKey)}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {question.label.trim() === "" ? "Untitled question" : question.label}
                </span>
                {question.required ? <Badge variant="muted">Required</Badge> : null}
                {question.visibilityRule === null ? null : (
                  <Badge variant="default">Conditional</Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {TYPE_LABELS[question.type]}
              </span>
            </button>

            <span className="flex shrink-0 flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0 || props.isBusy}
                onClick={() => props.onMove(question.questionKey, -1)}
              >
                {`Move ${question.label || "question"} up`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={index === ordered.length - 1 || props.isBusy}
                onClick={() => props.onMove(question.questionKey, 1)}
              >
                {`Move ${question.label || "question"} down`}
              </Button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
