/**
 * Deadline formatting.
 *
 * A deadline is the single most consequential thing this product displays, and
 * the cycle carries a `time_zone` precisely so it is shown in the one the
 * director set it in. Rendering it in the *viewer's* zone would tell an
 * applicant in London that the deadline is February 1st when the form closes
 * on January 31st, and they would believe the page.
 */
import { describe, expect, it } from "vitest";

import { formatDeadline, formatTimestamp } from "@/lib/formatDate.ts";

describe("formatDeadline", () => {
  it("renders the instant in the cycle's time zone, not the viewer's", () => {
    // 04:59 UTC on February 1st is 23:59 on January 31st in Pittsburgh. Those
    // are different days, which is exactly how somebody misses a deadline by
    // believing the page.
    const text = formatDeadline("2027-02-01T04:59:00.000Z", "America/New_York");

    expect(text).toContain("January 31");
    expect(text).toContain("11:59");
  });

  it("names the zone, so the time it shows is checkable", () => {
    const text = formatDeadline("2027-02-01T04:59:00.000Z", "America/New_York");

    // Without the abbreviation the reader has no way to know whose clock this
    // is, and an applicant abroad has no way to convert it.
    expect(text).toMatch(/E[SD]T/);
  });

  it("falls back to the viewer's zone rather than throwing on a bad one", () => {
    // A time zone comes from a text column a human typed. A typo there must
    // degrade to a time that is merely less useful, never to a page that
    // fails to render the deadline at all.
    expect(() => formatDeadline("2027-02-01T04:59:00.000Z", "Not/AZone")).not.toThrow();
    expect(formatDeadline("2027-02-01T04:59:00.000Z", "Not/AZone")).not.toBe("");
  });

  it("says nothing rather than inventing a date when there is no deadline", () => {
    expect(formatDeadline(null, "America/New_York")).toBe("No deadline set");
  });
});

describe("formatTimestamp", () => {
  it("renders a saved-at instant in the viewer's own zone", () => {
    // The opposite choice from a deadline, deliberately. "Last saved" is about
    // something the person just did at their own desk, so their own clock is
    // the one that makes it recognisable.
    const text = formatTimestamp("2027-01-20T15:04:00.000Z");

    expect(text).not.toBe("");
    expect(text).toMatch(/\d/);
  });

  it("returns an empty string for nothing, so a caller renders nothing", () => {
    expect(formatTimestamp(null)).toBe("");
  });
});
