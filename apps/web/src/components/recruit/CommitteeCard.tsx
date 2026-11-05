import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge.tsx";
import { formatDeadlineDate } from "@/lib/formatDate.ts";

export interface CommitteeCardProps {
  teamSlug: string;
  teamName: string;
  description: string | null;
  accepting: boolean;
  opensAt: string | null;
  closesAt: string | null;
  /** The cycle's zone, so a date on this card means what the director meant. */
  timeZone: string;
  /** Where Apply goes. The landing page sends a guest to sign in first. */
  applyTo: "/signin" | "/app/committees";
}

/**
 * One committee on the public landing page.
 *
 * An `article` with an accessible name, so a screen reader user can move
 * between committees by landmark instead of reading the whole page, and so the
 * tests can address one card rather than matching text across all of them.
 *
 * **A committee that has not opened shows its date instead of an Apply
 * action.** A button leading to a closed form is worse than no button: it
 * spends somebody's attention and returns a refusal they cannot act on. And
 * the committee is still listed, because omitting it entirely would make
 * somebody conclude it is not recruiting at all.
 */
export function CommitteeCard(props: CommitteeCardProps) {
  const headingId = `committee-${props.teamSlug}`;
  const opensOn = formatDeadlineDate(props.opensAt, props.timeZone);
  const closesOn = formatDeadlineDate(props.closesAt, props.timeZone);

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col rounded-[10px] border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="text-base font-semibold">
          {props.teamName}
        </h3>
        {props.accepting ? (
          <Badge variant="success">Accepting applications</Badge>
        ) : (
          <Badge variant="muted">Not yet open</Badge>
        )}
      </div>

      {props.description === null ? null : (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.description}</p>
      )}

      <div className="mt-4 flex-1" />

      {props.accepting ? (
        <>
          {closesOn === "" ? null : (
            <p className="text-sm text-muted-foreground">Closes {closesOn}</p>
          )}
          <Link
            to={props.applyTo}
            search={props.applyTo === "/signin" ? { redirect: "/app/committees" } : undefined}
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Apply to {props.teamName}
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {opensOn === ""
            ? "Opening date to be announced."
            : `Applications open ${opensOn}. Check back then.`}
        </p>
      )}
    </article>
  );
}
