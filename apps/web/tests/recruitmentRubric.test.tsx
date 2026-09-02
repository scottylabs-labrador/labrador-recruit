import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCycles,
  setRubricVersions,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import { adminStanding, cycle, myStanding, rubricVersion } from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seedAdmin() {
  setSession(userSession());
  setCycles([cycle()]);
  setStanding(adminStanding());
}

describe("rubric editor", () => {
  it("explains the versioning model on the screen itself", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);

    await renderApp("/recruitment/cycle-1/rubric");

    expect(
      await screen.findByText("Publishing creates a new version — it never edits an old one"),
    ).toBeDefined();
    expect(screen.getByText(/pinned to the rubric version it was scored under/)).toBeDefined();
    expect(screen.getByText(/read-only history/)).toBeDefined();
  });

  it("presents a version with reviews attached as history rather than as a draft", async () => {
    seedAdmin();
    setRubricVersions([
      rubricVersion({ id: "rubric-v2", version: 2, reviewCount: 0, active: true }),
      rubricVersion({ id: "rubric-v1", version: 1, reviewCount: 7, active: false }),
    ]);

    await renderApp("/recruitment/cycle-1/rubric");

    expect(await screen.findByText("History")).toBeDefined();
    expect(
      screen.getByText(
        /7 submitted reviews are pinned to this version, so it is history: it cannot be edited or deleted\./,
      ),
    ).toBeDefined();
    expect(screen.getByText(/No review has been scored under this version yet\./)).toBeDefined();
  });

  it("seeds the editor from the active version so editing is copy-and-revise", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);

    await renderApp("/recruitment/cycle-1/rubric");

    const keys = await screen.findAllByLabelText("Key");
    expect(keys.map((input) => (input as HTMLInputElement).value)).toEqual([
      "technical_depth",
      "collaboration",
    ]);
    expect((screen.getByLabelText("Version name") as HTMLInputElement).value).toBe("Cycle rubric");
  });

  it("shows the running weight total as a decimal and a percentage", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);

    await renderApp("/recruitment/cycle-1/rubric");

    expect(await screen.findByText("Active weight total")).toBeDefined();
    expect(screen.getByText("1.000")).toBeDefined();
    expect(screen.getByText("(100.0%)")).toBeDefined();
    expect(screen.getByText(/Sums to 1 — valid/)).toBeDefined();
  });

  it("blocks publish while the weights do not sum to 1, and says why", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/rubric");

    const weights = await screen.findAllByLabelText("Weight (fraction of 1)");
    const first = weights[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("expected a weight field");

    await user.clear(first);
    await user.type(first, "0.5");

    expect(await screen.findByText("0.900")).toBeDefined();
    expect(screen.getByText("(90.0%)")).toBeDefined();
    expect(screen.getByText(/Must sum to exactly 1 \(100%\)/)).toBeDefined();
    expect(screen.getByText("Publishing is blocked")).toBeDefined();
    expect(
      screen.getByText(
        /The active weights sum to 0\.900 \(90\.0%\) rather than 1 \(100%\)\. Adjust them so they add up to exactly 1\./,
      ),
    ).toBeDefined();

    const publish = screen.getByRole("button", { name: "Publish new version" });
    expect(publish.hasAttribute("disabled")).toBe(true);
  });

  it("renders the server's own validation issues verbatim", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/rubric");

    const weights = await screen.findAllByLabelText("Weight (fraction of 1)");
    const first = weights[0];
    if (first === undefined) throw new Error("expected a weight field");

    await user.clear(first);
    await user.type(first, "0.5");

    expect(await screen.findByText("Reported by the server")).toBeDefined();
    expect(
      screen.getByText(
        "The active criteria weights sum to 0.9 rather than 1. Adjust the weights so they add up to exactly 1.",
      ),
    ).toBeDefined();
    expect(requestsMatching("POST", "/rubrics/validate").length).toBeGreaterThan(0);
  });

  it("confirms before publishing and warns that a version cannot be deleted", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/rubric");

    const publish = await screen.findByRole("button", { name: "Publish new version" });
    expect(publish.hasAttribute("disabled")).toBe(false);

    await user.click(publish);

    expect(screen.getByText(/A published version cannot be deleted\./)).toBeDefined();
    // Confirming is a distinct action, so nothing has been published yet.
    expect(
      requestsMatching("POST", "/rubrics").filter((entry) => !entry.url.endsWith("validate")),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Yes, publish this version/ }));

    expect(await screen.findByText(/Published version 2 — Cycle rubric\./)).toBeDefined();
  });

  it("lets a criterion be added and removed", async () => {
    seedAdmin();
    setRubricVersions([rubricVersion()]);
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/rubric");

    await user.click(await screen.findByRole("button", { name: /Add criterion/ }));
    expect(screen.getAllByLabelText("Key")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Remove criterion 3" }));
    expect(screen.getAllByLabelText("Key")).toHaveLength(2);
  });

  it("refuses the screen to a reviewer", async () => {
    setSession(userSession());
    setCycles([cycle()]);
    setStanding(myStanding());

    await renderApp("/recruitment/cycle-1/rubric");

    expect(
      await screen.findByText("Editing the rubric is a recruitment-admin action"),
    ).toBeDefined();
    expect(screen.queryByLabelText("Version name")).toBeNull();
    expect(requestsMatching("POST", "/rubrics/validate")).toHaveLength(0);
  });
});
