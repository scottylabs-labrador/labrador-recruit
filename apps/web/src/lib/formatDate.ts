/**
 * Two formatters, and the difference between them is deliberate.
 *
 * A **deadline** is rendered in the cycle's time zone. The `recruitment_cycle`
 * table carries `time_zone` for exactly this: a director in Pittsburgh set
 * "11:59pm on January 31st", and an applicant must read back the instant that
 * director meant. Rendering it in the viewer's zone would tell somebody in
 * London the deadline is February 1st, and they would believe the page.
 *
 * A **timestamp** like "last saved" is rendered in the viewer's own zone,
 * because it describes something they just did at their own desk and their own
 * clock is what makes it recognisable.
 *
 * Whether a deadline has *passed* is never decided here. That is the server's
 * job against `timestamptz`, and a client clock is not evidence.
 */

const DEADLINE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/**
 * A deadline, in the time zone the cycle set it in.
 *
 * The zone is named in the output. Without the abbreviation the reader has no
 * way to tell whose clock this is, and an applicant abroad has no way to
 * convert it.
 */
export function formatDeadline(iso: string | null, timeZone: string): string {
  if (iso === null) {
    return "No deadline set";
  }

  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    return "No deadline set";
  }

  try {
    return new Intl.DateTimeFormat("en-US", { ...DEADLINE_OPTIONS, timeZone }).format(instant);
  } catch {
    /*
     * The zone came from a text column a human typed.
     *
     * A typo there must degrade to a time that is merely less useful than
     * intended, never to a page that fails to render the deadline at all —
     * which is the one piece of information an applicant cannot do without.
     */
    return new Intl.DateTimeFormat("en-US", DEADLINE_OPTIONS).format(instant);
  }
}

/** A deadline reduced to its date, for a card where the full form is too long. */
export function formatDeadlineDate(iso: string | null, timeZone: string): string {
  if (iso === null) {
    return "";
  }

  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    return "";
  }

  const options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(instant);
  }
}

/**
 * An instant in the viewer's own time zone.
 *
 * Returns an empty string for nothing, so a caller can render it directly
 * rather than branching — "last saved " with no time is a sentence the page
 * should simply not contain.
 */
export function formatTimestamp(iso: string | null): string {
  if (iso === null) {
    return "";
  }

  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
