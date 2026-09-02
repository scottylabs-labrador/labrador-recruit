import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  requestsMatching,
  setCommitReport,
  setCycles,
  setImportPreview,
  setImportRows,
  setImports,
  setSession,
  setStanding,
} from "./msw/handlers.ts";
import {
  adminStanding,
  cycle,
  failedImportRow,
  importCommitReport,
  importPreview,
  importRowOutcome,
  importSummary,
  myStanding,
} from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

function seedAdmin() {
  setSession(userSession());
  setCycles([cycle()]);
  setStanding(adminStanding());
}

function exportFile() {
  return new File(["Email Address\nrobin@example.edu\n"], "fall-2026-responses.csv", {
    type: "text/csv",
  });
}

async function uploadFixtureFile(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("Application export file");
  await user.upload(input, exportFile());
  await user.click(screen.getByRole("button", { name: /Upload and preview/ }));
}

describe("application import", () => {
  it("shows the chosen filename and size before anything is uploaded", async () => {
    seedAdmin();
    setImportPreview(importPreview());
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/import");

    const input = await screen.findByLabelText("Application export file");
    await user.upload(input, exportFile());

    expect(screen.getByText("fall-2026-responses.csv")).toBeDefined();
    expect(screen.getByText(/bytes|KB/)).toBeDefined();
    // Choosing a file is not uploading one.
    expect(requestsMatching("POST", "/imports")).toHaveLength(0);
  });

  it("surfaces unmapped and missing headers, and every failing row, in the preview", async () => {
    seedAdmin();
    setImportPreview(
      importPreview({
        rowCount: 3,
        okCount: 1,
        errorCount: 1,
        mapping: {
          fields: [],
          unmappedHeaders: ["Which language do you like most?"],
          missingHeaders: ["Rank the committees"],
        },
        duplicateEmails: ["robin@example.edu"],
        failures: [
          failedImportRow(4, [
            {
              column: "Email Address",
              field: "email",
              message: "This is not a well-formed email address.",
              value: "robin at example",
            },
          ]),
        ],
      }),
    );
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/import");
    await uploadFixtureFile(user);

    expect(await screen.findByText(/Column mapping problem/)).toBeDefined();
    expect(screen.getByText("Rank the committees")).toBeDefined();
    expect(screen.getByText("Which language do you like most?")).toBeDefined();

    // Counts.
    expect(screen.getByText("Rows read")).toBeDefined();
    expect(screen.getByText("Rows with errors")).toBeDefined();

    // Duplicates.
    expect(screen.getByText("robin@example.edu")).toBeDefined();

    // The failing row, named by source row number, column, and message.
    expect(screen.getByText("This is not a well-formed email address.")).toBeDefined();
    expect(screen.getByText("Email Address")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
  });

  it("says so plainly when every column matched", async () => {
    seedAdmin();
    setImportPreview(importPreview());
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/import");
    await uploadFixtureFile(user);

    expect(await screen.findByText(/Every expected column was matched/)).toBeDefined();
    expect(screen.getByText("Every row passed validation.")).toBeDefined();
  });

  it("keeps commit as an explicit second step and reports what it wrote", async () => {
    seedAdmin();
    setImportPreview(importPreview());
    setCommitReport(
      importCommitReport({ created: 2, updated: 1, unknownCommitteeSlugs: ["robotics"] }),
    );
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/import");
    await uploadFixtureFile(user);

    await screen.findByRole("button", { name: "Commit import" });
    // Previewing writes nothing: the commit endpoint has not been called.
    expect(requestsMatching("POST", "/commit")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Commit import" }));
    // Still nothing — the confirmation is its own step.
    expect(screen.getByText(/Applicants and candidacies are created or updated/)).toBeDefined();
    expect(requestsMatching("POST", "/commit")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Yes, commit this import/ }));

    expect(await screen.findByText("Commit report")).toBeDefined();
    expect(requestsMatching("POST", "/commit")).toHaveLength(1);
    expect(screen.getByText("Created")).toBeDefined();
    expect(screen.getByText("Candidacies created")).toBeDefined();
    expect(screen.getByText(/robotics/)).toBeDefined();
  });

  it("states that re-importing updates rather than duplicating, and never touches reviews", async () => {
    seedAdmin();

    await renderApp("/recruitment/cycle-1/import");

    expect(await screen.findByText("Re-importing the same file is safe")).toBeDefined();
    expect(screen.getByText(/never deletes a candidacy and never touches a review/)).toBeDefined();
  });

  it("lists prior imports and opens one to show its per-row outcomes", async () => {
    seedAdmin();
    setImports([importSummary()]);
    setImportRows([
      importRowOutcome({ sourceRowNumber: 2, status: "imported" }),
      importRowOutcome({
        sourceRowNumber: 5,
        status: "error",
        errorMessage: "Email Address: this is not a well-formed email address.",
      }),
    ]);
    const user = userEvent.setup();

    await renderApp("/recruitment/cycle-1/import");

    expect(await screen.findByText("fall-2026-responses.xlsx")).toBeDefined();
    expect(screen.getByText("Committed")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Show rows of/ }));

    expect(await screen.findByText("Per-row outcomes")).toBeDefined();
    expect(screen.getByText("Created")).toBeDefined();
    expect(
      screen.getByText("Email Address: this is not a well-formed email address."),
    ).toBeDefined();
  });

  it("refuses the screen to a reviewer instead of letting them upload", async () => {
    setSession(userSession());
    setCycles([cycle()]);
    setStanding(myStanding());

    await renderApp("/recruitment/cycle-1/import");

    expect(
      await screen.findByText("Importing applications is a recruitment-admin action"),
    ).toBeDefined();
    expect(screen.queryByLabelText("Application export file")).toBeNull();
    expect(requestsMatching("GET", "/imports")).toHaveLength(0);
  });
});
