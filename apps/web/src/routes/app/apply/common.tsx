import type { AnswerValue } from "@recruit/common";
import { createFileRoute } from "@tanstack/react-router";

import type { SaveResult } from "@/components/applicant/ApplicationForm.tsx";
import { ApplicationForm } from "@/components/applicant/ApplicationForm.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api, apiFetch } from "@/lib/apiClient";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/apply/common")({
  component: CommonFormPage,
});

/**
 * The questions every committee sees, answered once.
 *
 * Two requests, deliberately: the response says which form and at what
 * revision, and the form says what the questions are. The response names the
 * form rather than the page assuming it, because which form is the common one
 * is the server's business and an applicant's answers belong to a specific
 * version of it.
 */
function CommonFormPage() {
  const response = $api.useQuery("get", "/me/common-response", {}, absenceIsNormal);
  const formId = response.data?.formId;
  const published = $api.useQuery(
    "get",
    "/forms/{formId}/published",
    { params: { path: { formId: formId ?? "" } } },
    { enabled: formId !== undefined, ...absenceIsNormal },
  );

  if (response.isPending || (formId !== undefined && published.isPending)) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (response.data === undefined || published.data === undefined) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">The shared questions are not ready yet</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          ScottyLabs has not published the shared questions for this cycle. Nothing is wrong with
          your account — check back shortly, or ask a ScottyLabs administrator if the deadline is
          close.
        </p>
      </div>
    );
  }

  const locked = response.data.locked;

  async function save(
    revision: number,
    answers: { questionKey: string; value: AnswerValue }[],
  ): Promise<SaveResult> {
    /*
     * The raw client, because the status code decides what to say.
     *
     * A 409 means another tab is ahead and reloading is the fix; anything else
     * means the save may work on a retry. Telling somebody to retry a conflict
     * is telling them to overwrite their own newer answers.
     */
    const {
      data,
      error,
      response: http,
    } = await apiFetch.PATCH("/me/common-response/draft", {
      body: { revision, answers },
    });

    if (data !== undefined) {
      return { outcome: "saved", revision: data.revision, savedAt: data.savedAt };
    }
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : undefined;
    return http.status === 409 ? { outcome: "conflict", message } : { outcome: "error", message };
  }

  return (
    <ApplicationForm
      title={published.data.title}
      description={published.data.description}
      questions={published.data.questions}
      initialAnswers={response.data.answers}
      initialRevision={response.data.revision}
      readOnlyReason={
        locked
          ? "You have submitted an application, so these shared answers can no longer be changed. They stay here so you can read back exactly what every committee received. If something in them is wrong, ask a ScottyLabs administrator — they can correct it on your behalf."
          : null
      }
      save={save}
    />
  );
}
