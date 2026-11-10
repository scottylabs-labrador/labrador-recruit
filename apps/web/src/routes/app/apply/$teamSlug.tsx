import type { AnswerValue } from "@recruit/common";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { SaveResult } from "@/components/applicant/ApplicationForm.tsx";
import { ApplicationForm } from "@/components/applicant/ApplicationForm.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api, apiFetch } from "@/lib/apiClient";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/apply/$teamSlug")({
  component: CommitteeFormPage,
});

/**
 * One committee's own questions.
 *
 * The slug is resolved to an application through the applicant's own list
 * rather than used to address anything directly. That is not a security
 * measure — the endpoints are scoped to the caller regardless — it is simply
 * that the slug names a committee and the thing being edited is an
 * application, and only the caller's own list can connect the two.
 */
function CommitteeFormPage() {
  const { teamSlug } = Route.useParams();
  const applications = $api.useQuery("get", "/me/applications", {});
  const summary = applications.data?.find((row) => row.committeeSlug === teamSlug);

  const detail = $api.useQuery(
    "get",
    "/me/applications/{applicationId}",
    { params: { path: { applicationId: summary?.applicationId ?? "" } } },
    { enabled: summary !== undefined, ...absenceIsNormal },
  );

  const formId = detail.data?.formId;
  const published = $api.useQuery(
    "get",
    "/forms/{formId}/published",
    { params: { path: { formId: formId ?? "" } } },
    { enabled: formId !== undefined && formId !== null, ...absenceIsNormal },
  );

  if (applications.isPending || (summary !== undefined && detail.isPending)) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  /*
   * Reached by typing a URL or following an old link.
   *
   * Saying what is missing and where to fix it beats rendering an empty form
   * that cannot save, which is what an applicant would otherwise sit in front
   * of without knowing why nothing happened.
   */
  if (summary === undefined || detail.data === undefined) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">You have not applied to this committee</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          There is no application to open here yet. Start one from the committee list, and this page
          will hold its questions.
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

  if (published.isPending && formId !== undefined && formId !== null) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (published.data === undefined) {
    /*
     * A real state, not a fault: a director opened the committee for
     * applications before publishing its questions. An empty page here would
     * read as a broken application rather than as somebody else's unfinished
     * work.
     */
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">
          {summary.committeeName}&rsquo;s questions are not ready yet
        </h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          Your application to {summary.committeeName} has been started, but the committee has not
          published its questions. Nothing is wrong with your application — check back shortly.
        </p>
        <Link to="/app/dashboard" className="mt-6 inline-block text-sm font-medium underline">
          Back to your dashboard
        </Link>
      </div>
    );
  }

  const applicationId = summary.applicationId;
  const submitted = summary.submittedAt !== null;
  const withdrawn = summary.status === "Withdrawn";

  async function save(
    revision: number,
    answers: { questionKey: string; value: AnswerValue }[],
  ): Promise<SaveResult> {
    const {
      data,
      error,
      response: http,
    } = await apiFetch.PATCH("/me/applications/{applicationId}/draft", {
      params: { path: { applicationId } },
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
      initialAnswers={detail.data.answers}
      initialRevision={detail.data.revision}
      readOnlyReason={
        withdrawn
          ? `You withdrew this application, so ${summary.committeeName} is no longer considering it. Your answers stay here for your own reference.`
          : submitted
            ? `You submitted this application, so it can no longer be changed. It stays here so you can read back exactly what ${summary.committeeName} received.`
            : null
      }
      save={save}
    />
  );
}
