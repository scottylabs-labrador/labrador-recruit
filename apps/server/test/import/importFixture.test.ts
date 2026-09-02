import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { detectMapping } from "../../src/lib/import/headerMap.ts";
import { buildImportPreview, normalizeRow } from "../../src/lib/import/normalizeRow.ts";
import { parseXlsx } from "../../src/lib/import/parseWorkbook.ts";
import type {
  ImportPreview,
  NormalizedApplication,
  ParsedSheet,
} from "../../src/lib/import/types.ts";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "fall-2026-sample.xlsx",
);

let sheet: ParsedSheet;
let preview: ImportPreview;

beforeAll(async () => {
  sheet = await parseXlsx(await readFile(FIXTURE_PATH), "Form Responses 1");
  preview = buildImportPreview(sheet, detectMapping(sheet.headers));
});

function applicationFor(email: string): NormalizedApplication {
  const found = preview.results.find((result) => result.ok && result.application.email === email);
  if (found === undefined || !found.ok) {
    throw new Error(`No successfully imported row for ${email}`);
  }
  return found.application;
}

describe("Fall 2026 fixture, end to end", () => {
  it("maps every column of the export with nothing left over", () => {
    expect(preview.mapping.fields).toHaveLength(66);
    expect(preview.mapping.unmappedHeaders).toEqual([]);
    expect(preview.mapping.missingHeaders).toEqual([]);
  });

  it("reads all twelve rows and isolates only the two bad ones", () => {
    expect(preview.rowCount).toBe(12);
    expect(preview.okCount).toBe(10);
    expect(preview.errorCount).toBe(2);
  });

  it("rejects the row with no email while its neighbours still import", () => {
    const failed = preview.results.filter((result) => !result.ok);
    const missingEmail = failed.find((result) => result.sourceRowNumber === 3);

    expect(missingEmail?.ok).toBe(false);
    if (missingEmail?.ok === false) {
      expect(missingEmail.errors.map((error) => error.field)).toEqual(["email"]);
      expect(missingEmail.errors[0]?.column).toBe("Email Address");
    }
    // The rows on either side of it are unaffected.
    expect(applicationFor("ada@andrew.cmu.edu").sourceRowNumber).toBe(2);
    expect(preview.results[2]?.ok).toBe(true);
  });

  it("rejects the malformed ranking, naming the exact ranking column", () => {
    const failed = preview.results.find((result) => !result.ok && result.sourceRowNumber === 5);

    expect(failed?.ok).toBe(false);
    if (failed?.ok === false) {
      expect(failed.errors).toHaveLength(1);
      expect(failed.errors[0]?.column).toBe("Committee Ranking [Tech]");
      expect(failed.errors[0]?.value).toBe("Top pick honestly");
    }
  });

  it("reports the duplicate email rather than silently dropping a submission", () => {
    expect(preview.duplicateEmails).toEqual(["ada@andrew.cmu.edu"]);
    const submissions = preview.results.filter(
      (result) => result.ok && result.application.email === "ada@andrew.cmu.edu",
    );
    expect(submissions).toHaveLength(2);
  });

  it("parses every committee ranking as 1 through 7", () => {
    for (const result of preview.results) {
      if (!result.ok) {
        continue;
      }
      for (const preference of Object.values(result.application.committeePreferences)) {
        expect(preference.rank).toBeGreaterThanOrEqual(1);
        expect(preference.rank).toBeLessThanOrEqual(7);
      }
    }

    const ada = applicationFor("ada@andrew.cmu.edu");
    expect(Object.keys(ada.committeePreferences)).toHaveLength(7);
    expect(ada.committeePreferences["tech"]).toEqual({ rank: 1, rawLabel: "1st Choice" });
    expect(ada.committeePreferences["foundry"]).toEqual({ rank: 7, rawLabel: "7th Choice" });
  });

  it("imports the Tech-only candidate with just the Tech block answered", () => {
    const dorian = applicationFor("dorian@andrew.cmu.edu");
    expect(dorian.fullName).toBe("Dorian Placeholder");
    expect(dorian.year).toBe("senior");
    expect(dorian.committeeOptIns).toEqual({
      tech: true,
      labrador: false,
      foundry: false,
      finance: false,
      events: false,
      design: false,
    });
    expect(dorian.answers.map((answer) => answer.questionKey)).toEqual([
      "tech_project",
      "tech_projects_of_interest",
    ]);
  });

  it("imports the Labrador-only candidate, shape-checking links without visiting them", () => {
    const echo = applicationFor("echo@andrew.cmu.edu");
    expect(echo.year).toBe("grad");
    expect(echo.committeeOptIns["labrador"]).toBe(true);
    expect(echo.answers).toHaveLength(7);

    const social = echo.answers.find((answer) => answer.questionKey === "labrador_social_link");
    expect(social?.answerText).toBe("instagram.com/fake.echo.mockworth");
    expect(social?.answerJson).toEqual({ url: "https://instagram.com/fake.echo.mockworth" });
  });

  it("imports the Foundry candidate's three sub-team ranks from their labels", () => {
    const fen = applicationFor("fen@andrew.cmu.edu");
    expect(fen.subteamPreferences).toEqual([
      { committeeSlug: "foundry", subteamKey: "talent", rank: 2, rawLabel: "2nd Choice" },
      { committeeSlug: "foundry", subteamKey: "accelerator", rank: 1, rawLabel: "1st Choice" },
      { committeeSlug: "foundry", subteamKey: "outreach", rank: 3, rawLabel: "3rd Choice" },
    ]);
    expect(fen.committeePreferences["foundry"]?.rank).toBe(1);
  });

  it("imports the Finance candidate's numeric sub-team ranks", () => {
    const gia = applicationFor("gia@andrew.cmu.edu");
    const byTeam = Object.fromEntries(
      gia.subteamPreferences.map((preference) => [preference.subteamKey, preference.rank]),
    );

    expect(gia.subteamPreferences).toHaveLength(6);
    expect(byTeam).toEqual({
      "local-sponsorship": 1,
      documentation: 5,
      "university-relations": 3,
      "purchasing-planning": 4,
      "sponsor-relations": 2,
      "corporate-sponsorship": 6,
    });
    expect(gia.subteamPreferences.every((p) => p.committeeSlug === "finance")).toBe(true);
  });

  it("imports the Events candidate, whose opt-in wording is the odd one out", () => {
    const hugo = applicationFor("hugo@andrew.cmu.edu");
    expect(hugo.committeeOptIns["events"]).toBe(true);
    expect(hugo.answers.map((answer) => answer.questionKey)).toContain("events_waldo");
    // Every other block refused with "No, let me be done" or "No".
    expect(hugo.committeeOptIns["design"]).toBe(false);
  });

  it("imports the Design candidate's portfolio link as an https URL", () => {
    const iris = applicationFor("iris@andrew.cmu.edu");
    const portfolio = iris.answers.find((answer) => answer.questionKey === "design_portfolio_link");
    expect(portfolio?.answerJson).toEqual({ url: "https://figma.com/@fake-iris-faux" });
  });

  it("imports an Outreach first-choice applicant even though Outreach asks nothing", () => {
    const jules = applicationFor("jules@andrew.cmu.edu");

    expect(jules.committeePreferences["outreach"]).toEqual({ rank: 1, rawLabel: "1st Choice" });
    expect(Object.keys(jules.committeePreferences)).toHaveLength(7);
    // No Outreach question block exists, so the applicant has no Outreach
    // answers and no Outreach opt-in -- and that is not an error.
    expect(jules.answers).toEqual([]);
    expect(jules.committeeOptIns["outreach"]).toBeUndefined();
    expect(jules.subteamPreferences).toEqual([]);
  });

  it("omits blank optional answers rather than storing empty strings", () => {
    const kai = applicationFor("kai@andrew.cmu.edu");

    expect(kai.answers).toEqual([]);
    expect(kai.major).toBeNull();
    expect(kai.rankingExplanation).toBeNull();
    expect(kai.friendRequest).toBeNull();
    expect(kai.heardAboutScottylabs).toBeNull();
    expect(kai.committeeOptIns).toEqual({});
    expect(kai.year).toBe("unknown");
    expect(kai.rawYear).toBe("Not sure yet");
    expect(Object.keys(kai.committeePreferences)).toEqual(["tech"]);
  });

  it("never stores an empty string anywhere in an imported answer", () => {
    for (const result of preview.results) {
      if (!result.ok) {
        continue;
      }
      for (const answer of result.application.answers) {
        expect(answer.answerText).not.toBe("");
        expect(answer.answerText.trim()).toBe(answer.answerText);
      }
    }
  });

  it("hashes identically on a second pass over the same file", async () => {
    const again = await parseXlsx(await readFile(FIXTURE_PATH));
    const second = buildImportPreview(again, detectMapping(again.headers));

    expect(
      second.results.map((result) => (result.ok ? result.application.rowHash : result.rowHash)),
    ).toEqual(
      preview.results.map((result) => (result.ok ? result.application.rowHash : result.rowHash)),
    );
  });

  it("hashes differently once a single answer is edited", () => {
    const mapping = detectMapping(sheet.headers);
    const original = sheet.rows[0];
    expect(original).toBeDefined();
    if (original === undefined) {
      return;
    }

    const before = normalizeRow(original, mapping);
    const after = normalizeRow({ ...original, "Full Name": "Ada Testperson-Edited" }, mapping);

    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.application.rowHash).not.toBe(before.application.rowHash);
    }
  });

  it("assigns each imported row the spreadsheet line it came from", () => {
    expect(preview.results.map((result) => result.sourceRowNumber)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });
});
