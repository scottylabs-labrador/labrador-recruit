import { createFileRoute, Link } from "@tanstack/react-router";

import { DynamicFormRenderer } from "@/components/forms/DynamicFormRenderer";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { formatTimestamp } from "@/lib/formatDate.ts";
import { absenceIsNormal } from "@/lib/queryClient";

export const Route = createFileRoute("/app/submissions/$applicationId")({
  component: SubmissionDetailPage,
});

/**
 * One application, exactly as the committee received it.
 *
 * Both halves are shown: the shared answers went to this committee too, so
 * rendering only its own questions would misrepresent what was sent.
 * Read-only throughout — this is a record, not a form.
 */
function SubmissionDetailPage() {
  const { applicationId } = Route.useParams();

  const detail = $api.useQuery(
    "get",
    "/me/applications/{applicationId}",
    { params: { path: { applicationId } } },
    absenceIsNormal,
  );
  const committeeFormId = detail.data?.formId;
  const committeeForm = $api.useQuery(
    "get",
    "/forms/{formId}/published",
    { params: { path: { formId: committeeFormId ?? "" } } },
    { enabled: committeeFormId !== undefined && committeeFormId !== null, ...absenceIsNormal },
  );

  const common = $api.useQuery("get", "/me/common-response", {}, absenceIsNormal);
  const commonFormId = common.data?.formId;
  const commonForm = $api.useQuery(
    "get",
    "/forms/{formId}/published",
    { params: { path: { formId: commonFormId ?? "" } } },
    { enabled: commonFormId !== undefined, ...absenceIsNormal },
  );

  if (detail.isPending) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (detail.data === undefined) {
    /*
     * The same words for "not yours" as for "never existed".
     *
     * The endpoint answers 404 to both, deliberately, so nobody can confirm
     * another applicant's application exists by guessing an id. A page saying
     * "you do not have permission" would be the oracle the API refused to be.
     */
    return (
      <div className="mx-auto w-full max-w-[820px] px-6 py-16">
        <h1 className="text-xl font-semibold">We could not find that application</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          The link may be out of date. Your own applications are all listed in your history.
        </p>
        <Link to="/app/submissions" className="mt-6 inline-block text-sm font-medium underline">
          Back to your applications
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link to="/app/submissions" className="underline">
            Your applications
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{detail.data.committeeName}</h1>
          <Badge variant={detail.data.status === "Withdrawn" ? "danger" : "default"}>
            {detail.data.status}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {detail.data.submittedAt === null
            ? "Not submitted yet."
            : `Submitted ${formatTimestamp(detail.data.submittedAt)}.`}
        </p>
      </header>

      {commonForm.data === undefined || common.data === undefined ? null : (
        <section aria-labelledby="shared" className="mt-10 border-t border-border pt-8">
          <h2 id="shared" className="text-lg font-semibold">
            Shared questions
          </h2>
          <div className="mt-4">
            <DynamicFormRenderer
              questions={commonForm.data.questions}
              answers={common.data.answers}
              mode="readonly"
            />
          </div>
        </section>
      )}

      {committeeForm.data === undefined ? null : (
        <section aria-labelledby="committee" className="mt-10 border-t border-border pt-8">
          <h2 id="committee" className="text-lg font-semibold">
            {detail.data.committeeName}&rsquo;s questions
          </h2>
          <div className="mt-4">
            <DynamicFormRenderer
              questions={committeeForm.data.questions}
              answers={detail.data.answers}
              mode="readonly"
            />
          </div>
        </section>
      )}
    </div>
  );
}
