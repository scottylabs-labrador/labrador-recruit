import type { AnswerMap, AnswerValue, QuestionDefinition } from "@recruit/common";
import { useCallback, useEffect, useRef, useState } from "react";

import { DynamicFormRenderer } from "@/components/forms/DynamicFormRenderer";
import { Button } from "@/components/ui/button.tsx";
import { formatTimestamp } from "@/lib/formatDate.ts";

/**
 * How long a pause counts as "stopped typing".
 *
 * Long enough that a burst of typing is one request rather than one per
 * keystroke — each of which would also conflict on the revision with the one
 * before it — and short enough that closing a laptop mid-sentence does not
 * lose the sentence.
 */
export const AUTOSAVE_IDLE_MS = 1_500;

export interface SaveResult {
  outcome: "saved" | "conflict" | "error";
  revision?: number;
  savedAt?: string;
  message?: string;
}

export interface ApplicationFormProps {
  title: string;
  description: string | null;
  questions: readonly QuestionDefinition[];
  initialAnswers: AnswerMap;
  initialRevision: number;
  /** Read-only, with this sentence saying why. Locked means unchangeable, not invisible. */
  readOnlyReason: string | null;
  save: (
    revision: number,
    answers: { questionKey: string; value: AnswerValue }[],
  ) => Promise<SaveResult>;
}

/**
 * One application form, for the shared questions and for a committee's.
 *
 * Owns the answers, the revision, and the autosave. The answers live here
 * rather than in the renderer because all three of those are one mechanism:
 * the revision is what the server checks, autosave is what sends it, and what
 * was typed is what must survive a refusal.
 *
 * **A conflict never discards anything.** A student with a laptop and a phone
 * both autosaving is the ordinary case, not an edge case. When the server says
 * its revision is newer, this says so in those words, stops autosaving so it
 * cannot loop, and leaves every field exactly as it was — the one outcome that
 * is unacceptable here is losing what somebody wrote.
 */
export function ApplicationForm(props: ApplicationFormProps) {
  const [answers, setAnswers] = useState<AnswerMap>(props.initialAnswers);
  const [revision, setRevision] = useState(props.initialRevision);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * Which answers have changed since the last successful save.
   *
   * A ref rather than state, because the autosave timer reads it at the moment
   * it fires and must see what is true then, not what was true when the effect
   * that scheduled it ran.
   *
   * Only the changed keys are sent. The server merges, so sending everything
   * would work, but it would also mean a slow save from one tab overwriting a
   * field the other tab had just changed.
   */
  const dirty = useRef<Set<string>>(new Set());
  const [dirtyCount, setDirtyCount] = useState(0);

  const readOnly = props.readOnlyReason !== null;

  const flush = useCallback(async () => {
    if (dirty.current.size === 0 || isSaving || conflict !== null) {
      return;
    }
    const keys = [...dirty.current];
    const payload = keys.map((questionKey) => ({
      questionKey,
      value: answers[questionKey] ?? null,
    }));

    setIsSaving(true);
    setFailure(null);
    const result = await props.save(revision, payload);
    setIsSaving(false);

    if (result.outcome === "saved") {
      /*
       * Only the keys that were in flight are cleared.
       *
       * Anything typed while the request was open stays dirty and goes in the
       * next save. Clearing the whole set would silently drop it.
       */
      for (const key of keys) {
        dirty.current.delete(key);
      }
      setDirtyCount(dirty.current.size);
      setRevision(result.revision ?? revision);
      setLastSavedAt(result.savedAt ?? new Date().toISOString());
      return;
    }

    if (result.outcome === "conflict") {
      setConflict(
        result.message ?? "Your answers were changed somewhere else, so this save was refused.",
      );
      return;
    }

    setFailure(result.message ?? "Could not save your draft. Check your connection.");
  }, [answers, conflict, isSaving, props, revision]);

  /*
   * Autosave on a pause, and only when something actually changed.
   *
   * `dirtyCount` is in the dependencies rather than the ref itself, because a
   * ref does not re-run an effect — and without it the timer would be
   * scheduled once and never again.
   */
  useEffect(() => {
    if (readOnly || dirtyCount === 0 || conflict !== null) {
      return;
    }
    const timer = setTimeout(() => {
      void flush();
    }, AUTOSAVE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [conflict, dirtyCount, flush, readOnly]);

  function change(questionKey: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionKey]: value }));
    dirty.current.add(questionKey);
    setDirtyCount(dirty.current.size);
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold">{props.title}</h1>
        {props.description === null ? null : (
          <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">{props.description}</p>
        )}
      </header>

      {readOnly ? (
        <div className="mt-6 rounded-[10px] border border-border bg-muted/40 p-4">
          <p className="text-sm leading-6">{props.readOnlyReason}</p>
        </div>
      ) : null}

      {conflict === null ? null : (
        <div
          role="alert"
          className="mt-6 rounded-[10px] border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="text-sm font-medium">{conflict}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Nothing you typed here has been lost — it is still on this page, and it has not been
            saved. Open this form again in one place only, then copy anything you want to keep into
            it.
          </p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => location.reload()}>
            Reload this form
          </Button>
        </div>
      )}

      {failure === null ? null : (
        <div role="alert" className="mt-6 rounded-[10px] border border-border bg-muted/40 p-4">
          <p className="text-sm leading-6">{failure}</p>
        </div>
      )}

      <div className="mt-8">
        <DynamicFormRenderer
          questions={props.questions}
          answers={answers}
          mode={readOnly ? "readonly" : "edit"}
          onChange={change}
        />
      </div>

      {readOnly ? null : (
        <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-border pt-6">
          <Button onClick={() => void flush()} disabled={isSaving || dirtyCount === 0}>
            {isSaving ? "Saving…" : "Save draft"}
          </Button>
          {/*
            Announced, not just drawn. Whether a draft reached the server is the
            thing an applicant most needs to know and the thing a visual-only
            indicator does not tell a screen reader at all.
          */}
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {isSaving
              ? "Saving your draft…"
              : dirtyCount > 0
                ? "Not saved yet — this saves on its own in a moment."
                : lastSavedAt === null
                  ? "Your answers save as you type."
                  : `Saved ${formatTimestamp(lastSavedAt)}.`}
          </p>
        </div>
      )}
    </div>
  );
}
