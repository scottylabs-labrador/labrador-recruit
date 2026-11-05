import type { AnswerMap, QuestionDefinition } from "@recruit/common";
import { validateResponse } from "@recruit/common";
import { useQueries } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { DynamicFormRenderer } from "@/components/forms/DynamicFormRenderer";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api, apiFetch } from "@/lib/apiClient";
import { formatDeadline } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/review")({
  component: ReviewPage,
});

/** The server's per-application detail from a 422. Rendered, never collapsed. */
interface Problem {
  applicationId: string;
  committeeName: string;
  missing: string[];
  invalid: { questionKey: string; message: string }[];
}

interface Section {
  key: string;
  heading: string;
  questions: readonly QuestionDefinition[];
  answers: AnswerMap;
  /** The page that holds these questions, for a link out of the problem list. */
  fix: { kind: "common" } | { kind: "committee"; teamSlug: string };
  missing: { questionKey: string; label: string }[];
  invalid: { questionKey: string; label: string; message: string }[];
}

function labelFor(questions: readonly QuestionDefinition[], questionKey: string): string {
  return questions.find((q) => q.questionKey === questionKey)?.label ?? questionKey;
}

/**
 * Everything about to be sent, on one page, and the act of sending it.
 *
 * Validated with `validateResponse` from `@recruit/common` — the same function
 * the server runs. That is the entire reason it lives there: this copy is a
 * courtesy so an applicant can fix an omission before submitting, and the
 * server's copy is the rule. A second, lookalike validator here would
 * eventually disagree with the one that decides, and the applicant would be
 * the one to find out.
 *
 * Submission is one act for every unsubmitted application. All or nothing:
 * half a submission is the worst outcome available here.
 */
function ReviewPage() {
  const profile = $api.useQuery("get", "/me/profile", {}, absenceIsNormal);
  const cycle = $api.useQuery("get", "/cycles/current", {}, absenceIsNormal);
  const applications = $api.useQuery("get", "/me/applications", {});
  const common = $api.useQuery("get", "/me/common-response", {}, absenceIsNormal);

  const commonFormId = common.data?.formId;
  const commonForm = $api.useQuery(
    "get",
    "/forms/{formId}/published",
    { params: { path: { formId: commonFormId ?? "" } } },
    { enabled: commonFormId !== undefined, ...absenceIsNormal },
  );

  const summaries = applications.data ?? [];

  /*
   * One request per application, then one per form.
   *
   * `useQueries` rather than a loop of hooks, because the number of
   * applications is not known until the list arrives and hooks cannot be
   * called conditionally.
   */
  const details = useQueries({
    queries: summaries.map((row) => ({
      queryKey: ["review", "application", row.applicationId],
      queryFn: async () => {
        const { data } = await apiFetch.GET("/me/applications/{applicationId}", {
          params: { path: { applicationId: row.applicationId } },
        });
        return data ?? null;
      },
    })),
  });

  const formIds = details.map((query) => query.data?.formId ?? null);
  const committeeForms = useQueries({
    queries: formIds.map((formId) => ({
      queryKey: ["review", "form", formId],
      enabled: formId !== null,
      queryFn: async () => {
        if (formId === null) {
          return null;
        }
        const { data } = await apiFetch.GET("/forms/{formId}/published", {
          params: { path: { formId } },
        });
        return data ?? null;
      },
    })),
  });

  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /*
   * One key per page load, reused for every attempt.
   *
   * The endpoint is idempotent per key, so a retry — a double click, a lost
   * response — is recognised as the same act. A fresh key per click would be
   * read as a second, separate submission and refused with a message the
   * applicant cannot interpret.
   */
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const loading =
    profile.isPending ||
    applications.isPending ||
    common.isPending ||
    (commonFormId !== undefined && commonForm.isPending) ||
    details.some((query) => query.isPending) ||
    committeeForms.some((query) => query.isPending);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  const unsubmitted = summaries.filter((row) => row.submittedAt === null && row.status === "Draft");

  if (summaries.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">Nothing to submit yet</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          You have not started an application. Pick the committees you are interested in, answer
          their questions, and this page will show you everything before you send it.
        </p>
        <Link
          to="/app/committees"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Browse committees
        </Link>
      </div>
    );
  }

  const sections: Section[] = [];

  if (commonForm.data !== undefined && common.data !== undefined) {
    const questions = commonForm.data.questions;
    const answers = common.data.answers;
    const result = validateResponse(questions, answers);
    sections.push({
      key: "common",
      heading: "Shared questions",
      questions,
      answers,
      fix: { kind: "common" },
      missing: result.missing.map((questionKey) => ({
        questionKey,
        label: labelFor(questions, questionKey),
      })),
      invalid: result.invalid.map((problem) => ({
        questionKey: problem.questionKey,
        label: labelFor(questions, problem.questionKey),
        message: problem.message,
      })),
    });
  }

  summaries.forEach((row, index) => {
    const detail = details[index]?.data;
    const form = committeeForms[index]?.data;
    if (detail === undefined || detail === null || form === undefined || form === null) {
      return;
    }
    const result = validateResponse(form.questions, detail.answers);
    sections.push({
      key: row.applicationId,
      heading: row.committeeName,
      questions: form.questions,
      answers: detail.answers,
      fix: { kind: "committee", teamSlug: row.committeeSlug },
      // A submitted application is not something the applicant can still fix,
      // so it is shown but never counted as blocking.
      missing:
        row.submittedAt === null
          ? result.missing.map((questionKey) => ({
              questionKey,
              label: labelFor(form.questions, questionKey),
            }))
          : [],
      invalid:
        row.submittedAt === null
          ? result.invalid.map((problem) => ({
              questionKey: problem.questionKey,
              label: labelFor(form.questions, problem.questionKey),
              message: problem.message,
            }))
          : [],
    });
  });

  const blocking = sections.filter(
    (section) => section.missing.length > 0 || section.invalid.length > 0,
  );
  const canSubmit = blocking.length === 0 && unsubmitted.length > 0;

  async function submit() {
    setIsSubmitting(true);
    setProblems(null);
    setRefusal(null);

    const { data, error, response } = await apiFetch.POST("/me/submissions", {
      body: {
        idempotencyKey: idempotencyKey.current,
        applicationIds: unsubmitted.map((row) => row.applicationId),
      },
    });
    setIsSubmitting(false);

    if (data !== undefined) {
      /*
       * The confirmation comes from the server's answer, never from the click.
       *
       * An optimistic one would tell somebody their application is in when it
       * may not be, and this is the single sentence on the platform they are
       * most likely to rely on.
       */
      setSubmittedAt(data.submitted[0]?.submittedAt ?? new Date().toISOString());
      void applications.refetch();
      void common.refetch();
      return;
    }

    const body = (error ?? {}) as { message?: unknown; problems?: unknown };
    if (response.status === 422 && Array.isArray(body.problems)) {
      setProblems(body.problems as Problem[]);
      return;
    }
    setRefusal(
      typeof body.message === "string"
        ? body.message
        : "Could not submit. Check your connection and try again.",
    );
  }

  const deadline = formatDeadline(
    profile.data?.closesAt ?? null,
    cycle.data?.timeZone ?? "America/New_York",
  );

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold">Review and submit</h1>
        <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
          Everything below is what each committee will receive. Applications close {deadline}.
        </p>
      </header>

      {submittedAt !== null ? (
        <div role="status" className="mt-8 rounded-[10px] border border-border bg-muted/40 p-5">
          <h2 className="text-base font-semibold">Your application has been submitted</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sent {formatDeadline(submittedAt, cycle.data?.timeZone ?? "America/New_York")}. You will
            hear from ScottyLabs by email. You can read everything you sent from your{" "}
            <Link to="/app/submissions" className="font-medium underline">
              application history
            </Link>
            .
          </p>
        </div>
      ) : null}

      {problems === null ? null : (
        <div
          role="alert"
          className="mt-8 rounded-[10px] border border-destructive/40 bg-destructive/5 p-5"
        >
          <h2 className="text-base font-semibold">This could not be submitted yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The server checked its own copy of your answers and found something missing. The most
            likely cause is a draft that did not finish saving.
          </p>
          {problems.map((problem) => (
            <div key={problem.applicationId} className="mt-4">
              <p className="text-sm font-medium">{problem.committeeName}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {problem.missing.map((questionKey) => {
                  const section = sections.find(
                    (candidate) => candidate.key === problem.applicationId,
                  );
                  return (
                    <li key={questionKey}>
                      {section === undefined
                        ? questionKey
                        : labelFor(section.questions, questionKey)}{" "}
                      is missing
                    </li>
                  );
                })}
                {problem.invalid.map((entry) => (
                  <li key={entry.questionKey}>{entry.message}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {refusal === null ? null : (
        <div
          role="alert"
          className="mt-8 rounded-[10px] border border-destructive/40 bg-destructive/5 p-5"
        >
          <p className="text-sm leading-6">{refusal}</p>
        </div>
      )}

      {blocking.length === 0 ? null : (
        <section
          aria-labelledby="unfinished"
          className="mt-8 rounded-[10px] border border-border bg-muted/40 p-5"
        >
          <h2 id="unfinished" className="text-base font-semibold">
            Finish these before submitting
          </h2>
          {blocking.map((section) => (
            <div key={section.key} className="mt-4">
              <p className="text-sm font-medium">{section.heading}</p>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {section.missing.map((entry) => (
                  <li key={entry.questionKey} className="flex flex-wrap items-center gap-2">
                    <span>{entry.label}</span>
                    {/*
                      Named and linked, not counted. "3 questions are
                      incomplete" sends somebody hunting through every form.
                    */}
                    {section.fix.kind === "common" ? (
                      <Link to="/app/apply/common" className="text-xs font-medium underline">
                        Go to this question
                      </Link>
                    ) : (
                      <Link
                        to="/app/apply/$teamSlug"
                        params={{ teamSlug: section.fix.teamSlug }}
                        className="text-xs font-medium underline"
                      >
                        Go to this question
                      </Link>
                    )}
                  </li>
                ))}
                {section.invalid.map((entry) => (
                  <li key={entry.questionKey}>
                    {entry.label}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {sections.map((section) => (
        <section
          key={section.key}
          aria-labelledby={`review-${section.key}`}
          className="mt-10 border-t border-border pt-8"
        >
          <h2 id={`review-${section.key}`} className="text-lg font-semibold">
            {section.heading}
          </h2>
          <div className="mt-4">
            <DynamicFormRenderer
              questions={section.questions}
              answers={section.answers}
              mode="readonly"
            />
          </div>
        </section>
      ))}

      <div className="mt-12 border-t border-border pt-8">
        {unsubmitted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everything here has already submitted. Submitting is final, so there is nothing more to
            send.
          </p>
        ) : (
          <>
            <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Submitting sends {unsubmitted.length} application
              {unsubmitted.length === 1 ? "" : "s"} at once. You cannot change your answers
              afterwards — you can only withdraw an application you no longer want considered.
            </p>
            {canSubmit ? (
              <Button className="mt-4" disabled={isSubmitting} onClick={() => void submit()}>
                {isSubmitting ? "Submitting…" : "Submit my application"}
              </Button>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Finish the questions listed above, and this is where you will submit.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
