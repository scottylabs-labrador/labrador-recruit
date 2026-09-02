import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  applicantLabel,
  isExternalLink,
  type AnswerSection,
  type ApplicationDetail,
  yearLabel,
} from "@/lib/recruitment.ts";

interface ApplicationViewProps {
  application: ApplicationDetail;
  /** The committee this application is being read for, when there is one. */
  committeeId?: string | undefined;
  /**
   * `friendRequest` is context for leadership and is deliberately excluded from
   * every scoring path, so it is withheld while someone is scoring.
   */
  showLeadershipContext?: boolean | undefined;
}

export function ApplicationView({
  application,
  committeeId,
  showLeadershipContext = false,
}: ApplicationViewProps) {
  const generalSections = application.sections.filter((section) => section.committeeId === null);
  const committeeSections = application.sections.filter((section) => section.committeeId !== null);
  const focusedSection =
    committeeId === undefined
      ? undefined
      : committeeSections.find((section) => section.committeeId === committeeId);
  const otherCommitteeSections =
    committeeId === undefined
      ? committeeSections
      : committeeSections.filter((section) => section.committeeId !== committeeId);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{applicantLabel(application.applicantName)}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {yearLabel(application.year)}
            {application.major === null ? "" : ` · ${application.major}`}
            {application.email === null ? "" : ` · ${application.email}`}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CommitteePreferences application={application} committeeId={committeeId} />
          {application.rankingExplanation === null ? null : (
            <TextBlock
              label="Why they ranked the committees this way"
              value={application.rankingExplanation}
            />
          )}
          {application.heardAboutScottylabs === null ? null : (
            <TextBlock
              label="How they heard about ScottyLabs"
              value={application.heardAboutScottylabs}
            />
          )}
          {showLeadershipContext && application.friendRequest !== null ? (
            <TextBlock
              label="Friend request"
              hint="Context for leadership only. This never contributes to a score."
              value={application.friendRequest}
            />
          ) : null}
        </CardContent>
      </Card>

      {committeeId === undefined ? null : (
        <Section
          heading="Committee-specific response"
          section={focusedSection}
          emptyMessage="No committee-specific response submitted."
        />
      )}

      {generalSections.map((section) => (
        <Section key={section.section} heading={section.section} section={section} />
      ))}

      {otherCommitteeSections.map((section) => (
        <Section
          key={`${section.section}-${section.committeeId ?? "general"}`}
          heading={
            section.committeeName === null
              ? section.section
              : `${section.section} · ${section.committeeName}`
          }
          section={section}
        />
      ))}
    </div>
  );
}

function CommitteePreferences({
  application,
  committeeId,
}: {
  application: ApplicationDetail;
  committeeId: string | undefined;
}) {
  if (application.preferences.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This applicant submitted no committee ranking.
      </p>
    );
  }

  const ordered = [...application.preferences].sort((a, b) => a.rank - b.rank);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Their committee ranking</h3>
      <ol className="flex flex-col gap-1">
        {ordered.map((preference) => {
          const isCurrent = preference.committeeId === committeeId;
          return (
            <li
              key={preference.committeeId}
              className={
                isCurrent
                  ? "flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5"
                  : "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5"
              }
            >
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                {preference.rank}
              </span>
              <span className="text-[0.95rem]">{preference.name}</span>
              {isCurrent ? <Badge variant="outline">You are reviewing this one</Badge> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Section({
  heading,
  section,
  emptyMessage,
}: {
  heading: string;
  section: AnswerSection | undefined;
  emptyMessage?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {section === undefined || section.answers.length === 0 ? (
          <p className="text-[0.95rem] leading-7 text-muted-foreground">
            {emptyMessage ?? "No response submitted."}
          </p>
        ) : (
          [...section.answers]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((answer) => (
              <TextBlock key={answer.key} label={answer.questionText} value={answer.answerText} />
            ))
        )}
      </CardContent>
    </Card>
  );
}

function TextBlock({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-foreground">{label}</h4>
      {hint === undefined ? null : <p className="text-sm text-muted-foreground">{hint}</p>}
      <AnswerBody value={value} />
    </div>
  );
}

/**
 * Renders one submitted answer verbatim.
 *
 * An answer that is nothing but a URL becomes an ordinary anchor the reviewer
 * has to click themselves — never an `<img>`, an `<iframe>`, or a preview — and
 * carries `rel="noopener noreferrer"` so the destination learns nothing about
 * this page. Product rules forbid the platform from fetching applicant links on
 * the applicant's behalf, and a prefetch or an embed would do exactly that.
 * Prose is printed as plain text with no auto-linking for the same reason.
 */
function AnswerBody({ value }: { value: string | null }) {
  if (value === null || value.trim() === "") {
    return <p className="text-[0.95rem] leading-7 text-muted-foreground">No response submitted.</p>;
  }

  const trimmed = value.trim();
  if (isExternalLink(trimmed)) {
    return (
      <p className="text-[0.95rem] leading-7">
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 break-all text-primary-strong underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {trimmed}
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    );
  }

  return <p className="max-w-[70ch] text-[0.95rem] leading-7 whitespace-pre-wrap">{trimmed}</p>;
}
