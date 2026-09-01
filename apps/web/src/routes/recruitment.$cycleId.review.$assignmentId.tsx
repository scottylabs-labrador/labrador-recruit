import { canReadApplicantIdentity, canReopenReview } from "@labrador/access-control";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Loader2,
  Lock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApplicationView } from "@/components/recruitment/ApplicationView.tsx";
import { PeerReviews } from "@/components/recruitment/PeerReviews.tsx";
import { RubricCriterionField } from "@/components/recruitment/RubricCriterionField.tsx";
import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Checkbox, FieldError, Label, Select, Textarea } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import {
  applicantLabel,
  CONFIDENCE_OPTIONS,
  confidenceLabel,
  formatRank,
  RECOMMENDATION_OPTIONS,
  recommendationLabel,
  type ConfidenceValue,
  type RecommendationValue,
  type ReviewDetail,
  type SaveReviewRequest,
} from "@/lib/recruitment.ts";

const AUTOSAVE_DELAY_MS = 800;

export const Route = createFileRoute("/recruitment/$cycleId/review/$assignmentId")({
  component: ReviewPage,
});

interface FormState {
  scores: Record<string, number>;
  recommendation: RecommendationValue | "";
  confidence: ConfidenceValue | "";
  rationale: string;
  privateNotes: string;
  discussionFlag: boolean;
  underratedFlag: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function ReviewPage() {
  const { cycleId, assignmentId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const queue = $api.useQuery("get", "/recruitment/cycles/{cycleId}/my-queue", {
    params: { path: { cycleId } },
  });

  const queueItems = queue.data ?? [];
  const currentIndex = queueItems.findIndex((item) => item.assignmentId === assignmentId);
  const current = currentIndex === -1 ? undefined : queueItems[currentIndex];
  const previous = currentIndex > 0 ? queueItems[currentIndex - 1] : undefined;
  const next = currentIndex === -1 ? undefined : queueItems[currentIndex + 1];

  const reviewOptions = $api.queryOptions("get", "/recruitment/assignments/{assignmentId}/review", {
    params: { path: { assignmentId } },
  });
  const review = $api.useQuery("get", "/recruitment/assignments/{assignmentId}/review", {
    params: { path: { assignmentId } },
  });

  const application = $api.useQuery(
    "get",
    "/recruitment/applications/{applicationId}",
    { params: { path: { applicationId: current?.applicationId ?? "" } } },
    { enabled: current !== undefined },
  );
  const rubric = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees/{committeeId}/rubric",
    { params: { path: { cycleId, committeeId: current?.committeeId ?? "" } } },
    { enabled: current !== undefined },
  );

  // `/me` carries the caller's memberships, blind-review setting, and the
  // candidacies they have already submitted on, so both predicates below are the
  // server's own, evaluated over the server's own inputs.
  const { user, isLoaded: standingLoaded } = useRecruitmentUser(cycleId);
  // Only claim identity is being withheld once the standing is actually known,
  // so the notice never flashes on a cycle that is not running blind review.
  const identityHidden = standingLoaded && !canReadApplicantIdentity({ user, cycleId });
  const mayReopen = canReopenReview({ user });

  const [form, setForm] = useState<FormState | null>(null);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [showValidation, setShowValidation] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [confirmingConflict, setConfirmingConflict] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reviewData = review.data;
  useEffect(() => {
    if (reviewData === undefined) return;
    if (hydratedFor === reviewData.id) return;
    setForm(toFormState(reviewData));
    setHydratedFor(reviewData.id);
    setSaveStatus("idle");
  }, [reviewData, hydratedFor]);

  useEffect(
    () => () => {
      if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current);
    },
    [],
  );

  const saveDraft = $api.useMutation("put", "/recruitment/assignments/{assignmentId}/review", {
    onSuccess: (data) => {
      queryClient.setQueryData(reviewOptions.queryKey, data);
      setSaveStatus("saved");
    },
    onError: () => setSaveStatus("error"),
  });

  const submitReview = $api.useMutation(
    "post",
    "/recruitment/assignments/{assignmentId}/review/submit",
    {
      onSuccess: (data) => {
        queryClient.setQueryData(reviewOptions.queryKey, data);
        setConfirmingSubmit(false);
        void queue.refetch();
      },
    },
  );

  const declareConflict = $api.useMutation(
    "post",
    "/recruitment/assignments/{assignmentId}/conflict",
    {
      onSuccess: () => {
        setConfirmingConflict(false);
        void queue.refetch();
        void navigate({ to: "/recruitment/$cycleId/queue", params: { cycleId } });
      },
    },
  );

  const reopenReview = $api.useMutation(
    "post",
    "/recruitment/assignments/{assignmentId}/review/reopen",
    {
      onSuccess: () => {
        setHydratedFor(null);
        void review.refetch();
        void queue.refetch();
      },
    },
  );

  const locked = reviewData?.submittedAt != null;
  const conflicted = current?.status === "conflicted";
  const criteria = rubric.data?.criteria ?? [];

  function updateForm(patch: Partial<FormState>) {
    setForm((previousState) => {
      if (previousState === null) return previousState;
      const nextState = { ...previousState, ...patch };
      scheduleAutosave(nextState);
      return nextState;
    });
  }

  function scheduleAutosave(nextState: FormState) {
    if (locked || conflicted) return;
    if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current);
    setSaveStatus("saving");
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      saveDraft.mutate({
        params: { path: { assignmentId } },
        body: toSaveRequest(nextState),
      });
    }, AUTOSAVE_DELAY_MS);
  }

  const missingCriteria =
    form === null ? [] : criteria.filter((criterion) => form.scores[criterion.key] === undefined);
  const rationaleMissing = form === null || form.rationale.trim() === "";
  const recommendationMissing = form === null || form.recommendation === "";
  const confidenceMissing = form === null || form.confidence === "";
  const canSubmit =
    form !== null &&
    missingCriteria.length === 0 &&
    !rationaleMissing &&
    !recommendationMissing &&
    !confidenceMissing;

  function handleSubmitClick() {
    setShowValidation(true);
    if (!canSubmit || form === null) {
      setConfirmingSubmit(false);
      return;
    }
    setConfirmingSubmit(true);
  }

  function handleConfirmSubmit() {
    if (form === null) return;
    if (autosaveTimer.current !== null) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    submitReview.mutate({
      params: { path: { assignmentId } },
      body: toSaveRequest(form),
    });
  }

  if (review.isError || queue.isError) {
    return <ErrorState title="Could not open this review" error={review.error ?? queue.error} />;
  }

  if (queue.isLoading || review.isLoading) {
    return <ReviewSkeleton />;
  }

  if (current === undefined) {
    return (
      <EmptyState
        title="This assignment is not in your queue"
        description="It may have been reassigned or cancelled. Return to your queue to see what is currently assigned to you."
      >
        <Link
          to="/recruitment/$cycleId/queue"
          params={{ cycleId }}
          className="text-primary-strong underline underline-offset-4"
        >
          Back to my queue
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{applicantLabel(current.applicantName)}</h2>
            <Badge variant="outline">{current.committeeName}</Badge>
            <Badge variant="muted">Their rank {formatRank(current.applicantRank)}</Badge>
            {locked ? (
              <Badge variant="success">
                <Lock aria-hidden /> Submitted
              </Badge>
            ) : null}
            {conflicted ? (
              <Badge variant="warning">
                <AlertTriangle aria-hidden /> Conflict declared
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {current.year}
            {current.major === null ? "" : ` · ${current.major}`}
          </p>
          {identityHidden ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden />
              Blind review is on for this cycle, so applicant identity is withheld.
            </p>
          ) : null}
        </div>

        <nav aria-label="Queue navigation" className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={previous === undefined}
            onClick={() => {
              if (previous === undefined) return;
              void navigate({
                to: "/recruitment/$cycleId/review/$assignmentId",
                params: { cycleId, assignmentId: previous.assignmentId },
              });
            }}
          >
            <ChevronLeft aria-hidden data-icon="inline-start" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {currentIndex + 1} of {queueItems.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={next === undefined}
            onClick={() => {
              if (next === undefined) return;
              void navigate({
                to: "/recruitment/$cycleId/review/$assignmentId",
                params: { cycleId, assignmentId: next.assignmentId },
              });
            }}
          >
            Next
            <ChevronRight aria-hidden data-icon="inline-end" />
          </Button>
        </nav>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:items-start">
        <section aria-labelledby="application-heading" className="flex min-w-0 flex-col gap-4">
          <h3 id="application-heading" className="sr-only">
            The application
          </h3>
          {application.isError ? (
            <ErrorState title="Could not load the application" error={application.error} />
          ) : application.isLoading || application.data === undefined ? (
            <Skeleton className="h-96 w-full rounded-xl" />
          ) : (
            <ApplicationView application={application.data} committeeId={current.committeeId} />
          )}
        </section>

        <section
          aria-labelledby="rubric-heading"
          className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle id="rubric-heading">Your review</CardTitle>
                {locked ? null : <SaveIndicator status={saveStatus} />}
              </div>
              {locked ? (
                <p className="text-sm text-muted-foreground">
                  Submitted{" "}
                  {reviewData?.submittedAt == null
                    ? ""
                    : new Date(reviewData.submittedAt).toLocaleString()}
                  . This review is locked.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your draft saves automatically. Submitting is a separate, deliberate step.
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {conflicted ? (
                <p className="text-sm text-muted-foreground">
                  You declared a conflict of interest on this applicant, so there is nothing for you
                  to score. The applicant is not penalised.
                </p>
              ) : locked && reviewData !== undefined ? (
                <LockedReview review={reviewData} />
              ) : rubric.isError ? (
                <ErrorState title="Could not load the rubric" error={rubric.error} />
              ) : rubric.isLoading || form === null ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <>
                  {criteria.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      This committee has no rubric criteria configured.
                    </p>
                  ) : (
                    criteria.map((criterion) => (
                      <RubricCriterionField
                        key={criterion.id}
                        criterion={criterion}
                        value={form.scores[criterion.key]}
                        disabled={locked}
                        invalid={showValidation && form.scores[criterion.key] === undefined}
                        onChange={(score) =>
                          updateForm({ scores: { ...form.scores, [criterion.key]: score } })
                        }
                      />
                    ))
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="recommendation">Recommendation</Label>
                    <Select
                      id="recommendation"
                      value={form.recommendation}
                      aria-invalid={showValidation && recommendationMissing ? true : undefined}
                      aria-describedby={
                        showValidation && recommendationMissing ? "recommendation-error" : undefined
                      }
                      onChange={(event) =>
                        updateForm({ recommendation: event.target.value as RecommendationValue })
                      }
                    >
                      <option value="">Choose a recommendation…</option>
                      {RECOMMENDATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {showValidation && recommendationMissing ? (
                      <FieldError id="recommendation-error">
                        Choose a recommendation before submitting.
                      </FieldError>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="confidence">Confidence</Label>
                    <Select
                      id="confidence"
                      value={form.confidence}
                      aria-invalid={showValidation && confidenceMissing ? true : undefined}
                      aria-describedby={
                        showValidation && confidenceMissing ? "confidence-error" : undefined
                      }
                      onChange={(event) =>
                        updateForm({ confidence: event.target.value as ConfidenceValue })
                      }
                    >
                      <option value="">Choose a confidence level…</option>
                      {CONFIDENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {showValidation && confidenceMissing ? (
                      <FieldError id="confidence-error">
                        Say how confident you are before submitting.
                      </FieldError>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rationale">Rationale (required)</Label>
                    <p id="rationale-hint" className="text-sm leading-6 text-muted-foreground">
                      Say what in the application led you to these scores. Other reviewers and
                      leadership read this.
                    </p>
                    <Textarea
                      id="rationale"
                      value={form.rationale}
                      required
                      aria-required
                      aria-invalid={showValidation && rationaleMissing ? true : undefined}
                      aria-describedby={
                        showValidation && rationaleMissing
                          ? "rationale-hint rationale-error"
                          : "rationale-hint"
                      }
                      onChange={(event) => updateForm({ rationale: event.target.value })}
                    />
                    {showValidation && rationaleMissing ? (
                      <FieldError id="rationale-error">
                        A rationale is required before you can submit.
                      </FieldError>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="private-notes">Private notes (optional)</Label>
                    <p id="private-notes-hint" className="text-sm leading-6 text-muted-foreground">
                      Only you see these.
                    </p>
                    <Textarea
                      id="private-notes"
                      value={form.privateNotes}
                      aria-describedby="private-notes-hint"
                      onChange={(event) => updateForm({ privateNotes: event.target.value })}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="discussion-flag" className="flex items-start gap-2 text-sm">
                      <Checkbox
                        id="discussion-flag"
                        checked={form.discussionFlag}
                        onChange={(event) => updateForm({ discussionFlag: event.target.checked })}
                        className="mt-0.5"
                      />
                      <span>Bring this applicant to discussion</span>
                    </label>
                    <label htmlFor="underrated-flag" className="flex items-start gap-2 text-sm">
                      <Checkbox
                        id="underrated-flag"
                        checked={form.underratedFlag}
                        onChange={(event) => updateForm({ underratedFlag: event.target.checked })}
                        className="mt-0.5"
                      />
                      <span>I think we&rsquo;re underrating this applicant</span>
                    </label>
                  </div>

                  {confirmingSubmit ? (
                    <div
                      role="alertdialog"
                      aria-labelledby="submit-confirm-title"
                      aria-describedby="submit-confirm-body"
                      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3"
                    >
                      <p id="submit-confirm-title" className="text-sm font-semibold">
                        Submit this review?
                      </p>
                      <p
                        id="submit-confirm-body"
                        className="text-sm leading-6 text-muted-foreground"
                      >
                        Submitting locks your review. You will not be able to edit it afterwards —
                        only a recruitment admin can reopen it. You will then be able to see the
                        other reviews of this candidacy.
                      </p>
                      <div className="flex gap-2">
                        <Button onClick={handleConfirmSubmit} disabled={submitReview.isPending}>
                          {submitReview.isPending ? "Submitting…" : "Yes, submit and lock"}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmingSubmit(false)}>
                          Keep editing
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={handleSubmitClick} size="lg" className="w-full">
                      Submit review
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {locked && mayReopen ? (
            <Button
              variant="outline"
              size="sm"
              disabled={reopenReview.isPending}
              onClick={() => reopenReview.mutate({ params: { path: { assignmentId } } })}
            >
              Reopen this review
            </Button>
          ) : null}

          {conflicted ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Conflict of interest</CardTitle>
                <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground">
                  If you cannot review this applicant impartially, say so. You are never asked to
                  explain why, and the applicant is not penalised — they are simply routed to
                  another reviewer.
                </p>
              </CardHeader>
              <CardContent>
                {confirmingConflict ? (
                  <div
                    role="alertdialog"
                    aria-labelledby="conflict-confirm-title"
                    aria-describedby="conflict-confirm-body"
                    className="flex flex-col gap-2"
                  >
                    <p id="conflict-confirm-title" className="text-sm font-semibold">
                      Declare a conflict of interest?
                    </p>
                    <p
                      id="conflict-confirm-body"
                      className="text-sm leading-6 text-muted-foreground"
                    >
                      This removes the assignment from your queue and asks for another reviewer. You
                      cannot undo it yourself.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={declareConflict.isPending}
                        onClick={() =>
                          declareConflict.mutate({ params: { path: { assignmentId } } })
                        }
                      >
                        {declareConflict.isPending ? "Declaring…" : "Yes, declare conflict"}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingConflict(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmingConflict(true)}>
                    Declare conflict of interest
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {locked ? (
            <PeerReviews candidacyId={current.candidacyId} currentUserId={user.id} />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Not saved"
          : "No changes yet";

  return (
    <span
      role="status"
      aria-live="polite"
      className={
        status === "error"
          ? "flex items-center gap-1 text-sm font-medium text-destructive"
          : "flex items-center gap-1 text-sm text-muted-foreground"
      }
    >
      {status === "saving" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {status === "saved" ? <Check className="size-3.5" aria-hidden /> : null}
      {status === "error" ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
      {text}
    </span>
  );
}

function LockedReview({ review }: { review: ReviewDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Recommendation</dt>
        <dd>{recommendationLabel(review.recommendation)}</dd>
        <dt className="font-medium">Confidence</dt>
        <dd>{confidenceLabel(review.confidence)}</dd>
        <dt className="font-medium">Computed score</dt>
        <dd className="tabular-nums">{review.computedScore ?? "—"}</dd>
      </dl>
      {review.scores.length === 0 ? null : (
        <div>
          <h4 className="mb-1 text-sm font-semibold">Criterion scores</h4>
          <dl className="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 text-sm">
            {review.scores.map((score) => (
              <div key={score.criterionKey} className="contents">
                <dt className="text-muted-foreground">{score.criterionKey}</dt>
                <dd className="text-right tabular-nums">{score.score}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div>
        <h4 className="mb-1 text-sm font-semibold">Rationale</h4>
        <p className="max-w-[70ch] text-[0.95rem] leading-7 whitespace-pre-wrap">
          {review.rationale ?? "—"}
        </p>
      </div>
      {review.privateNotes === null || review.privateNotes === "" ? null : (
        <div>
          <h4 className="mb-1 text-sm font-semibold">Your private notes</h4>
          <p className="max-w-[70ch] text-[0.95rem] leading-7 whitespace-pre-wrap">
            {review.privateNotes}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {review.discussionFlag ? <Badge variant="outline">Flagged for discussion</Badge> : null}
        {review.underratedFlag ? <Badge variant="outline">Marked as underrated</Badge> : null}
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
      <Skeleton className="h-[32rem] w-full rounded-xl" />
    </div>
  );
}

function toFormState(review: ReviewDetail): FormState {
  const scores: Record<string, number> = {};
  for (const entry of review.scores) {
    scores[entry.criterionKey] = entry.score;
  }
  return {
    scores,
    recommendation: (review.recommendation ?? "") as RecommendationValue | "",
    confidence: (review.confidence ?? "") as ConfidenceValue | "",
    rationale: review.rationale ?? "",
    privateNotes: review.privateNotes ?? "",
    discussionFlag: review.discussionFlag,
    underratedFlag: review.underratedFlag,
  };
}

function toSaveRequest(form: FormState): SaveReviewRequest {
  const body: SaveReviewRequest = {
    scores: form.scores,
    rationale: form.rationale,
    privateNotes: form.privateNotes,
    discussionFlag: form.discussionFlag,
    underratedFlag: form.underratedFlag,
  };
  if (form.recommendation !== "") body.recommendation = form.recommendation;
  if (form.confidence !== "") body.confidence = form.confidence;
  return body;
}
