/**
 * The public recruitment landing page.
 *
 * Everything here is visible to anybody on the internet, so these tests are as
 * much about what the page does *not* say as what it does. They also pin the
 * two states that are easy to get wrong and look fine in development: a
 * committee that has not opened yet, and no cycle at all.
 */
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { DEFAULT_OPENINGS, setCurrentCycle, setOpenings } from "./msw/handlers.ts";
import { server } from "./msw/server.ts";
import { renderApp } from "./render.tsx";

describe("the recruitment landing page", () => {
  it("names the cycle and states the deadline in the cycle's time zone", async () => {
    await renderApp("/recruit");

    expect(await screen.findByRole("heading", { name: /spring 2027 recruitment/i })).toBeDefined();
    // 04:59 UTC on February 1st is 23:59 on January 31st in Pittsburgh, and the
    // director set it in Pittsburgh. `findAll` because the deadline legitimately
    // appears both in the header and on each committee card, and the precise
    // conversion is pinned in `formatDate.test.ts`.
    expect(await screen.findAllByText(/january 31/i)).not.toHaveLength(0);
  });

  it("shows a card per committee with its name and description", async () => {
    await renderApp("/recruit");

    const labrador = await screen.findByRole("article", { name: /labrador/i });
    expect(within(labrador).getByText(/product teams building for the CMU community/i));
    expect(await screen.findByRole("article", { name: /design/i })).toBeDefined();
  });

  it("offers a way in for a committee that is accepting applications", async () => {
    await renderApp("/recruit");

    const labrador = await screen.findByRole("article", { name: /labrador/i });
    expect(within(labrador).getByRole("link", { name: /apply/i })).toBeDefined();
  });

  it("shows the opening date rather than an Apply action before a committee opens", async () => {
    setOpenings([
      {
        ...DEFAULT_OPENINGS[0]!,
        accepting: false,
        opensAt: "2027-03-01T17:00:00.000Z",
      },
    ]);

    await renderApp("/recruit");

    const labrador = await screen.findByRole("article", { name: /labrador/i });
    // A button that leads to a closed form is worse than no button: it spends
    // somebody's attention and returns a refusal they cannot act on.
    expect(within(labrador).queryByRole("link", { name: /^apply/i })).toBeNull();
    expect(within(labrador).getByText(/march 1/i)).toBeDefined();
  });

  it("says nothing is recruiting rather than rendering an empty page", async () => {
    setOpenings([]);

    await renderApp("/recruit");

    expect(await screen.findByText(/no committees are recruiting/i)).toBeDefined();
  });

  it("explains that applications are not open when there is no cycle", async () => {
    // The endpoint answers 404, which is an ordinary state between seasons and
    // must not surface as an error page.
    setCurrentCycle(null);
    setOpenings([]);

    await renderApp("/recruit");

    expect(
      await screen.findByRole("heading", { name: /applications are not open/i }),
    ).toBeDefined();
    // The page is still the page. A 404 from the cycle endpoint is a state to
    // explain, not an error boundary to fall into, so everything a prospective
    // applicant came to read is still here.
    expect(await screen.findByRole("heading", { name: /how to apply/i })).toBeDefined();
  });

  it("reports no error for the ordinary between-seasons state", async () => {
    setCurrentCycle(null);
    setOpenings([]);

    await renderApp("/recruit");
    await screen.findByRole("heading", { name: /applications are not open/i });

    /*
     * A 404 here means "there is no cycle", which is what is true between
     * semesters. The global error toast reported it as a failure, so a
     * perfectly healthy deployment told every visitor something had gone
     * wrong, on top of a page that was already explaining itself correctly.
     */
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("still reports a genuine failure", async () => {
    // The other half of the previous test. Suppressing the toast for an
    // expected absence must not suppress it for a real fault, or the next
    // outage is silent.
    server.use(
      http.get("http://localhost:3001/v1/openings", () =>
        HttpResponse.json({ message: "Database unavailable" }, { status: 500 }),
      ),
    );

    await renderApp("/recruit");

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("states that no model evaluates an applicant", async () => {
    await renderApp("/recruit");

    // Product rule 1 is a promise made to applicants, so it belongs on the page
    // they read before deciding to apply.
    expect(await screen.findByText(/not evaluated by any model/i)).toBeDefined();
  });

  it("tells an applicant how the process works before they start", async () => {
    await renderApp("/recruit");

    expect(await screen.findByRole("heading", { name: /how to apply/i })).toBeDefined();
    expect(await screen.findByRole("heading", { name: /questions/i })).toBeDefined();
  });

  it("states the limit on committees when the cycle sets one", async () => {
    await renderApp("/recruit");

    // Finding out about the limit by being refused on the third application is
    // the worst time to learn it.
    expect(await screen.findByText(/up to 3 committees/i)).toBeDefined();
  });

  it("offers a way to sign in", async () => {
    await renderApp("/recruit");

    expect(await screen.findByRole("link", { name: /sign in/i })).toBeDefined();
  });
});
