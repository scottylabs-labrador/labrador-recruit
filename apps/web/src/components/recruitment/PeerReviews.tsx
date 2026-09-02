import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { $api } from "@/lib/apiClient";
import { confidenceLabel, formatStatistic, recommendationLabel } from "@/lib/recruitment.ts";

interface PeerReviewsProps {
  candidacyId: string;
  /** The caller's own id, so their review is labelled rather than shown as a peer's. */
  currentUserId: string;
}

/**
 * Peer reviews for a candidacy. Independent review is enforced in SQL: until the
 * caller has submitted, this endpoint returns only their own review. Rendering
 * it here is therefore safe, not a second gate.
 */
export function PeerReviews({ candidacyId, currentUserId }: PeerReviewsProps) {
  const reviews = $api.useQuery("get", "/recruitment/candidacies/{candidacyId}/reviews", {
    params: { path: { candidacyId } },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviews for this candidacy</CardTitle>
        <p className="text-sm text-muted-foreground">
          Visible now that your own review is submitted.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {reviews.isError ? (
          <ErrorState title="Could not load the other reviews" error={reviews.error} />
        ) : reviews.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (reviews.data ?? []).length === 0 ? (
          <EmptyState title="No submitted reviews yet" />
        ) : (
          (reviews.data ?? []).map((review) => (
            <article
              key={review.reviewId}
              className="flex flex-col gap-1.5 rounded-lg border border-border px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {review.reviewerUserId === currentUserId ? "You" : review.reviewerUserId}
                </span>
                <Badge variant="outline">{recommendationLabel(review.recommendation)}</Badge>
                <Badge variant="muted">{confidenceLabel(review.confidence)} confidence</Badge>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Score {formatStatistic(review.computedScore)}
                </span>
              </div>
              <p className="max-w-[70ch] text-[0.95rem] leading-7 whitespace-pre-wrap">
                {review.rationale ?? "No rationale recorded."}
              </p>
            </article>
          ))
        )}
      </CardContent>
    </Card>
  );
}
