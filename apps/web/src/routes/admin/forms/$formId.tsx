import type { AnswerMap, AnswerValue, QuestionDefinition } from "@recruit/common";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "react-toastify";

import { FormCanvas } from "@/components/builder/FormCanvas.tsx";
import { QuestionSettings } from "@/components/builder/QuestionSettings.tsx";
import { QuestionToolbox } from "@/components/builder/QuestionToolbox.tsx";
import { DynamicFormRenderer } from "@/components/forms/DynamicFormRenderer";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api, apiFetch } from "@/lib/apiClient";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/admin/forms/$formId")({
  component: FormBuilderPage,
});

/** A problem the server reported at publish, named by question. */
interface RuleProblem {
  questionKey: string;
  message: string;
}

/** A key nothing else in the draft is using. */
function freeKey(existing: readonly QuestionDefinition[], base: string): string {
  if (!existing.some((row) => row.questionKey === base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.some((row) => row.questionKey === candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

/**
 * The three-panel form builder.
 *
 * Exists so a committee director can change their application form **without a
 * pull request, a deploy, or asking an engineer** — `docs/product-rules.md`
 * section 7 treats the absence of that as a defect in the platform's reason
 * for existing.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * **Preview renders `DynamicFormRenderer`** — the real student component,
 * imported. Not a lookalike built for the builder. A preview's entire value is
 * that it cannot be wrong, and a second implementation can.
 *
 * **The conditional rule is structured data**, evaluated in the preview by the
 * same `evaluateVisibility` the server validates with. A second evaluator here
 * would eventually disagree, and a director would be confidently misled about
 * when a question appears.
 */
function FormBuilderPage() {
  const { formId } = Route.useParams();
  const draft = $api.useQuery(
    "get",
    "/forms/{formId}/draft",
    { params: { path: { formId } } },
    absenceIsNormal,
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<AnswerMap>({});
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [problems, setProblems] = useState<RuleProblem[] | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (draft.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (draft.data === undefined) {
    /*
     * The same words for "not yours" as for "no such form".
     *
     * The endpoint answers 404 to both so that a director of one committee
     * cannot confirm another's form exists by guessing an id; a page that said
     * "you do not have permission" would be the oracle the API refused to be.
     */
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">We could not find that form</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          The link may be out of date, or the form may belong to a committee you do not work on.
        </p>
      </div>
    );
  }

  const data = draft.data;
  const questions = [...data.questions].sort((a, b) => a.position - b.position);
  const selected = questions.find((row) => row.questionKey === selectedKey) ?? null;
  const earlier =
    selected === null ? [] : questions.filter((row) => row.position < selected.position);

  async function reload() {
    await draft.refetch();
  }

  async function run(work: () => Promise<unknown>) {
    setIsBusy(true);
    try {
      await work();
      await reload();
    } finally {
      setIsBusy(false);
    }
  }

  async function addQuestion(type: QuestionDefinition["type"]) {
    const key = freeKey(questions, type.replace(/_/g, "-"));
    await run(async () => {
      const { error } = await apiFetch.POST("/forms/{formId}/questions", {
        params: { path: { formId } },
        body: {
          questionKey: key,
          type,
          label: "",
          // A choice type with no choices cannot be saved, so a new one starts
          // with an empty slot rather than an empty list.
          config: ["single_select", "multi_select", "dropdown"].includes(type)
            ? { choices: [""] }
            : null,
        },
      });
      if (error !== undefined) {
        toast.error(messageFrom(error, "Could not add that question."));
        return;
      }
      setSelectedKey(key);
    });
  }

  async function saveQuestion(next: QuestionDefinition) {
    await run(async () => {
      const { error } = await apiFetch.PATCH("/questions/{questionId}", {
        params: { path: { questionId: `q-${next.questionKey}` } },
        body: {
          questionKey: next.questionKey,
          type: next.type,
          label: next.label,
          description: next.description ?? null,
          required: next.required,
          config: next.config,
          visibilityRule: next.visibilityRule,
        },
      });
      if (error !== undefined) {
        // The server's own words: it knows about duplicate keys and empty
        // choice lists, and its message is the one a director can act on.
        toast.error(messageFrom(error, "Could not save that question."));
      }
    });
  }

  async function deleteQuestion(questionKey: string) {
    await run(async () => {
      await apiFetch.DELETE("/questions/{questionId}", {
        params: { path: { questionId: `q-${questionKey}` } },
      });
      setSelectedKey(null);
    });
  }

  async function duplicateQuestion(source: QuestionDefinition) {
    const key = freeKey(questions, `${source.questionKey}-copy`);
    await run(async () => {
      const { error } = await apiFetch.POST("/forms/{formId}/questions", {
        params: { path: { formId } },
        body: {
          questionKey: key,
          type: source.type,
          label: source.label,
          description: source.description ?? null,
          required: source.required,
          config: source.config,
          /*
           * The rule is **not** copied.
           *
           * A duplicate lands at the end of the form, so a rule that was valid
           * where the original sat may now point at a question that comes
           * after it — which publish would refuse. Dropping it is the honest
           * default; keeping it would hand the director a form that cannot be
           * published for a reason they did not create.
           */
          visibilityRule: null,
        },
      });
      if (error !== undefined) {
        toast.error(messageFrom(error, "Could not duplicate that question."));
        return;
      }
      setSelectedKey(key);
    });
  }

  async function move(questionKey: string, direction: -1 | 1) {
    const index = questions.findIndex((row) => row.questionKey === questionKey);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= questions.length) {
      return;
    }
    const next = [...questions];
    [next[index], next[target]] = [next[target]!, next[index]!];

    await run(async () => {
      // The whole order, every time. Position decides which questions a rule
      // can reference, so a partial update could leave a rule pointing forward.
      const { error } = await apiFetch.POST("/forms/{formId}/reorder", {
        params: { path: { formId } },
        body: { questionIds: next.map((row) => `q-${row.questionKey}`) },
      });
      if (error !== undefined) {
        toast.error(messageFrom(error, "Could not reorder the questions."));
      }
    });
  }

  async function saveTitle(title: string) {
    if (title.trim() === "" || title === data.title) {
      return;
    }
    await run(async () => {
      await apiFetch.PATCH("/forms/{formId}/draft", {
        params: { path: { formId } },
        body: { title },
      });
    });
  }

  async function publish() {
    setProblems(null);
    await run(async () => {
      const { data: result, error } = await apiFetch.POST("/forms/{formId}/publish", {
        params: { path: { formId } },
      });
      if (result !== undefined) {
        setPublishedAt(result.publishedAt);
        setConfirmingPublish(false);
        return;
      }
      const body = (error ?? {}) as { message?: unknown; problems?: unknown };
      if (Array.isArray(body.problems)) {
        /*
         * Rendered per question, never collapsed.
         *
         * The server checks the whole set at publish — forward references,
         * self references, unknown keys, choice drift — and names the question
         * in each problem. "Could not publish" would send a director hunting
         * through forty of them.
         */
        setProblems(body.problems as RuleProblem[]);
        return;
      }
      toast.error(typeof body.message === "string" ? body.message : "Could not publish.");
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Input
            aria-label="Form title"
            className="h-10 max-w-[32rem] text-lg font-semibold"
            defaultValue={data.title}
            onBlur={(event) => void saveTitle(event.target.value)}
          />
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="muted">{`Version ${data.version}`}</Badge>
            {/* Two versions can exist at once. A director editing version 3
                should know versions 1 and 2 are out there being answered. */}
            <span>Not yet published — applicants still see the last published version.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPreviewing(!previewing)}>
            {previewing ? "Back to editing" : "Preview"}
          </Button>
          {/*
            Withheld from `canPublish`, which the server computes from the same
            ability its publish route gates on. A question editor sees no
            Publish affordance at all; the route refuses them anyway.
          */}
          {data.canPublish ? (
            <Button disabled={isBusy} onClick={() => setConfirmingPublish(true)}>
              Publish this version
            </Button>
          ) : null}
        </div>
      </header>

      {publishedAt === null ? null : (
        <div role="status" className="mt-6 rounded-[10px] border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Published. Applicants now see this version.</p>
        </div>
      )}

      {problems === null ? null : (
        <div
          role="alert"
          className="mt-6 rounded-[10px] border border-destructive/40 bg-destructive/5 p-4"
        >
          <h2 className="text-sm font-semibold">This form cannot be published yet</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {problems.map((problem) => (
              <li key={`${problem.questionKey}-${problem.message}`}>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => {
                    setProblems(null);
                    setPreviewing(false);
                    setSelectedKey(problem.questionKey);
                  }}
                >
                  <span className="font-medium">{problem.questionKey}</span> — {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmingPublish ? (
        <div className="mt-6 rounded-[10px] border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Publish version {data.version}?</p>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
            This version cannot be changed afterwards. It is what applicants answer against, and
            their answers are stored against it — so editing later means a new version, and this one
            stays exactly as it was asked.
          </p>
          <div className="mt-3 flex gap-2">
            <Button disabled={isBusy} onClick={() => void publish()}>
              {isBusy ? "Publishing…" : "Yes, publish it"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingPublish(false)}>
              Keep editing
            </Button>
          </div>
        </div>
      ) : null}

      {previewing ? (
        <section aria-labelledby="preview" className="mt-8 max-w-[820px]">
          <h2 id="preview" className="text-sm font-semibold">
            Preview — exactly what an applicant sees
          </h2>
          <div className="mt-4 rounded-[10px] border border-border bg-card p-6">
            {/*
              The student component, imported. Not a lookalike: a preview's
              whole value is that it cannot be wrong, and conditional questions
              appear and disappear here through the same `evaluateVisibility`
              the server validates with.
            */}
            <DynamicFormRenderer
              questions={questions}
              answers={previewAnswers}
              mode="edit"
              onChange={(questionKey: string, value: AnswerValue) =>
                setPreviewAnswers((current) => ({ ...current, [questionKey]: value }))
              }
            />
          </div>
        </section>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[16rem_1fr_20rem]">
          <QuestionToolbox onAdd={(type) => void addQuestion(type)} disabled={isBusy} />

          <section aria-labelledby="canvas">
            <h2 id="canvas" className="sr-only">
              Questions
            </h2>
            <FormCanvas
              questions={questions}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onMove={(key, direction) => void move(key, direction)}
              isBusy={isBusy}
            />
          </section>

          {selected === null ? (
            <p className="text-sm text-muted-foreground">
              Pick a question to change its settings, or add one from the left.
            </p>
          ) : (
            <QuestionSettings
              question={selected}
              earlier={earlier}
              isSaving={isBusy}
              onSave={(next) => void saveQuestion(next)}
              onDelete={() => void deleteQuestion(selected.questionKey)}
              onDuplicate={() => void duplicateQuestion(selected)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function messageFrom(error: unknown, fallback: string): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : fallback;
}
