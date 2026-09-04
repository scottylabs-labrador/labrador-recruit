import { ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { $api } from "@/lib/apiClient";
import { formatDateTime } from "@/lib/recruitment.ts";

/**
 * What GitHub says about an applicant who supplied a GitHub link.
 *
 * Everything here is printed as GitHub states it or as the applicant wrote it:
 * repository name, their own description, language, stars, last push. No
 * summary is generated, nothing is scored, and none of it feeds an aggregate.
 * `docs/product-rules.md` §1 permits this list and nothing beyond it.
 *
 * Labelled as fetched from GitHub, with the time, so a reviewer can tell it
 * apart from what the applicant submitted to us.
 */
export function GithubFacts({ applicationId }: { applicationId: string }) {
  const profile = $api.useQuery("get", "/recruitment/applications/{applicationId}/github", {
    params: { path: { applicationId } },
  });

  const refresh = $api.useMutation(
    "post",
    "/recruitment/applications/{applicationId}/github/refresh",
    { onSuccess: () => void profile.refetch() },
  );

  // Absent while loading, rather than a skeleton: this is context beside the
  // application, and a box that flickers in is more distracting than one that
  // simply appears.
  if (profile.isPending || profile.isError) {
    return null;
  }

  const data = profile.data.profile;

  // No link supplied, or something that was not a GitHub account. Not a
  // failure, and not worth a card - most applicants leave the field blank.
  if (data === null) {
    return null;
  }

  const repos = data.repos;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          GitHub
          <span className="ml-2 text-sm font-normal text-muted-foreground">@{data.username}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm leading-6 text-muted-foreground">
          Fetched from GitHub
          {data.fetchedAt === null ? " (never)" : ` on ${formatDateTime(data.fetchedAt)}`}, not
          submitted by the applicant. Shown exactly as GitHub states it.
        </p>

        {data.error !== null ? (
          <p className="text-sm leading-6">{`No GitHub data: ${data.error.toLowerCase()}.`}</p>
        ) : repos.length === 0 ? (
          <p className="text-sm leading-6">
            No public repositories of their own. A private account or one with only forks looks the
            same from outside.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {repos.map((repo) => (
              <li key={repo.url} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {repo.name}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {repo.language === null ? null : <Badge variant="outline">{repo.language}</Badge>}
                  {repo.stars > 0 ? (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {`${String(repo.stars)} ★`}
                    </span>
                  ) : null}
                </div>
                {repo.description === null ? null : (
                  <p className="text-sm leading-6 text-muted-foreground">{repo.description}</p>
                )}
                {repo.pushedAt === null ? null : (
                  <p className="text-xs text-muted-foreground">
                    {`Last pushed ${formatDateTime(repo.pushedAt)}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate({ params: { path: { applicationId } } });
            }}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {refresh.isPending ? "Asking GitHub…" : "Refresh"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
