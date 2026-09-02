import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Workbook } from "exceljs";

import { FALL_2026_MAPPING } from "../../src/lib/import/headerMap.ts";

/**
 * Builds the synthetic Fall 2026 spreadsheet the import tests run against.
 *
 * Regenerate with `bun run test/fixtures/buildFixture.ts` from `apps/server`.
 * Both this script and its output are committed: the script is the readable
 * definition of what each row is meant to exercise, and the .xlsx is what
 * proves exceljs actually round-trips it.
 *
 * Every applicant here is invented. Product rule 6 forbids committing a real
 * export, so the fixture is structurally faithful and factually fictional.
 */
const SHEET_NAME = "Form Responses 1";
const FIXTURE_FILENAME = "fall-2026-sample.xlsx";

/** One fixture row, keyed by the stable field key rather than by header text. */
type FixtureRow = Record<string, string | number>;

const CHOICE_LABELS = [
  "1st Choice",
  "2nd Choice",
  "3rd Choice",
  "4th Choice",
  "5th Choice",
  "6th Choice",
  "7th Choice",
];

/** Expands `{ tech: 1, design: 2 }` into the seven ranking columns. */
function ranks(order: Record<string, number>): FixtureRow {
  const row: FixtureRow = {};
  for (const [slug, position] of Object.entries(order)) {
    const label = CHOICE_LABELS[position - 1];
    if (label === undefined) {
      throw new Error(`No choice label for position ${position}`);
    }
    row[`committee_rank_${slug}`] = label;
  }
  return row;
}

/** Declines every committee question block, which is the common default. */
const DECLINE_ALL: FixtureRow = {
  tech_opt_in: "No",
  labrador_opt_in: "No",
  foundry_opt_in: "No",
  foundry_analyst_opt_in: "No",
  foundry_builder_opt_in: "No",
  finance_opt_in: "No",
  events_opt_in: "No, let me be done",
  design_opt_in: "No",
};

const ROWS: FixtureRow[] = [
  // 1. Complete, valid, opts into Tech. The happy path.
  {
    timestamp: "2026-09-01 09:00:00",
    email: "ada@andrew.cmu.edu",
    full_name: "Ada Testperson",
    major: "Information Systems, minor in Design",
    year: "First Year",
    ...ranks({ tech: 1, design: 2, finance: 3, events: 4, outreach: 5, labrador: 6, foundry: 7 }),
    ranking_explanation: "Tech first because I like building things that other students use.",
    friend_request: "Bruno Fakename",
    heard_about: "A friend on my floor",
    ...DECLINE_ALL,
    tech_opt_in: "Yes",
    tech_project: "A campus bus tracker that I wrote the backend for.",
    tech_projects_of_interest: "TartanHacks. I would want to own a slice of the backend.",
  },

  // 2. Missing email. Must fail on its own without disturbing any other row.
  {
    timestamp: "2026-09-01 09:04:00",
    full_name: "Bruno Fakename",
    major: "Statistics",
    year: "Sophomore",
    ...ranks({ tech: 2, design: 1, finance: 3, events: 4, outreach: 5, labrador: 6, foundry: 7 }),
    ...DECLINE_ALL,
  },

  // 3. Same email as row 1. Reported as a duplicate, not as an error.
  {
    timestamp: "2026-09-01 09:07:00",
    email: "ADA@andrew.cmu.edu",
    full_name: "Ada Testperson",
    major: "Information Systems",
    year: "First Year",
    ...ranks({ tech: 1, design: 2, finance: 3, events: 4, outreach: 5, labrador: 6, foundry: 7 }),
    ranking_explanation: "Resubmitting because I fixed a typo in my major.",
    ...DECLINE_ALL,
  },

  // 4. A ranking cell holding prose. The row is rejected, naming that column.
  {
    timestamp: "2026-09-01 09:11:00",
    email: "cleo@andrew.cmu.edu",
    full_name: "Cleo Sampleton",
    major: "Mechanical Engineering",
    year: "Junior",
    ...ranks({ design: 2, finance: 3, events: 4, outreach: 5, labrador: 6, foundry: 7 }),
    committee_rank_tech: "Top pick honestly",
    ...DECLINE_ALL,
  },

  // 5. Tech-only: answers exactly one committee's block.
  {
    timestamp: "2026-09-01 09:15:00",
    email: "dorian@andrew.cmu.edu",
    full_name: "Dorian  Placeholder",
    major: "Computer Science",
    year: "Senior",
    ...ranks({ tech: 1, design: 3, finance: 4, events: 5, outreach: 6, labrador: 2, foundry: 7 }),
    ranking_explanation: "Tech, then Labrador.",
    heard_about: "Orientation booth",
    ...DECLINE_ALL,
    tech_opt_in: "Yes",
    tech_project: "A terminal client for the campus dining API.",
    tech_projects_of_interest: "The dining API work, since I have already built against it.",
  },

  // 6. Labrador-only, including the two link columns.
  {
    timestamp: "2026-09-01 09:20:00",
    email: "echo@andrew.cmu.edu",
    full_name: "Echo Mockworth",
    major: "Creative Writing and HCI",
    year: "Grad",
    ...ranks({ tech: 5, design: 3, finance: 6, events: 4, outreach: 2, labrador: 1, foundry: 7 }),
    ranking_explanation: "Labrador is the closest fit to the writing I already do.",
    heard_about: "Instagram",
    ...DECLINE_ALL,
    labrador_opt_in: "Yes",
    labrador_idea: "A build-log series that follows one project from kickoff to launch.",
    labrador_role_preference:
      "Non-technical. I ran a club newsletter for two years and edited every issue.",
    labrador_interest: "I want to write about what the other committees ship.",
    labrador_fit: "I grew a writing circle from four people to thirty, so I know the slow part.",
    // A bare domain, which the normaliser upgrades to https without visiting it.
    labrador_social_link: "instagram.com/fake.echo.mockworth",
    labrador_github_link: "https://github.com/fake-echo-mockworth",
    labrador_additional: "Happy to start on drafts rather than posts.",
  },

  // 7. Foundry, including the three "1st Choice" sub-team columns.
  {
    timestamp: "2026-09-01 09:26:00",
    email: "fen@andrew.cmu.edu",
    full_name: "Fen Dummyfield",
    major: "Business Administration",
    year: "Sophomore",
    ...ranks({ tech: 4, design: 5, finance: 2, events: 6, outreach: 7, labrador: 3, foundry: 1 }),
    ranking_explanation: "Foundry first, Finance second.",
    heard_about: "A poster in Tepper",
    ...DECLINE_ALL,
    foundry_opt_in: "Yes",
    foundry_subteam_rank_talent: "2nd Choice",
    foundry_subteam_rank_accelerator: "1st Choice",
    foundry_subteam_rank_outreach: "3rd Choice",
    foundry_membership_type: "Analyst Member",
    foundry_entrepreneurship: "Shipping something small to real users, repeatedly.",
    foundry_building: "A pop-up print shop that runs during finals week.",
    foundry_cofounders: "Not yet",
    foundry_self_directed: "The print shop. Nobody asked for it and it broke even.",
    foundry_linkedin: "linkedin.com/in/fake-fen-dummyfield",
    foundry_portfolio: "https://fake-fen-dummyfield.example.com",
    foundry_analyst_opt_in: "Yes",
    foundry_startup_experience: "Two summers at a seed-stage company doing operations.",
    foundry_event_pitch: "A teardown night where founders show the version that did not work.",
    foundry_vc_thesis:
      "A fictional seed fund that only backs tools their own portfolio already pays for.",
    foundry_startup_thesis: "An invented campus logistics company; the wedge is the loading dock.",
    foundry_builder_opt_in: "No",
    foundry_track: "Analyst Member",
  },

  // 8. Finance, whose sub-team block exports bare numbers instead of labels.
  {
    timestamp: "2026-09-01 09:33:00",
    email: "gia@andrew.cmu.edu",
    full_name: "Gia Notreal",
    major: "Economics",
    year: "Junior",
    ...ranks({ tech: 6, design: 7, finance: 1, events: 3, outreach: 2, labrador: 5, foundry: 4 }),
    ranking_explanation: "Finance is where my coursework actually applies.",
    heard_about: "Career fair",
    ...DECLINE_ALL,
    finance_opt_in: "Yes",
    finance_subteam_rank_local_sponsorship: 1,
    finance_subteam_rank_documentation: 5,
    finance_subteam_rank_university_relations: 3,
    finance_subteam_rank_purchasing_planning: 4,
    finance_subteam_rank_sponsor_relations: 2,
    finance_subteam_rank_corporate_sponsorship: 6,
    finance_fruit: "A pomegranate. Disproportionate effort per unit of reward.",
    finance_bad_idea: "Treasurer of a 60-person club, on a spreadsheet with no formulas.",
    finance_hot_take: "Most sponsorship decks would work better as a single email.",
    finance_additional: "I can send a reference from the club advisor.",
  },

  // 9. Events, which is the block whose opt-in wording differs.
  {
    timestamp: "2026-09-01 09:40:00",
    email: "hugo@andrew.cmu.edu",
    full_name: "Hugo Synthetic",
    major: "Chemical Engineering",
    year: "First Year",
    ...ranks({ tech: 3, design: 4, finance: 5, events: 1, outreach: 2, labrador: 6, foundry: 7 }),
    ranking_explanation: "Events, because I want to run things rather than build them.",
    friend_request: "Iris Faux",
    heard_about: "Activities fair",
    ...DECLINE_ALL,
    events_opt_in: "Yes",
    events_waldo: "Behind the catering table, holding the last good coffee.",
    events_proud_of: "Rebooked a room two hours before an event lost its space.",
    events_opening_playlist: "Something with a countable beat so the room starts on time.",
    events_closing_playlist: "Whatever was playing when the last team submitted.",
    events_motivation: "I would rather run the thing than watch it.",
    events_question_critique: "I would ask about the worst event, which is more revealing.",
  },

  // 10. Design, including a portfolio link given as a bare domain.
  {
    timestamp: "2026-09-01 09:48:00",
    email: "iris@andrew.cmu.edu",
    full_name: "Iris Faux",
    major: "Design",
    year: "Senior",
    ...ranks({ tech: 5, design: 1, finance: 6, events: 3, outreach: 4, labrador: 2, foundry: 7 }),
    ranking_explanation: "Design first; I would also happily do Labrador.",
    heard_about: "A studio critique",
    ...DECLINE_ALL,
    design_opt_in: "Yes",
    design_focus: "Interface work, especially dense tables and forms.",
    design_portfolio_link: "figma.com/@fake-iris-faux",
  },

  // 11. Outreach as first choice. Outreach has no question block at all, so
  //     this row must import cleanly with a rank and no committee answers.
  {
    timestamp: "2026-09-01 09:55:00",
    email: "jules@andrew.cmu.edu",
    full_name: "Jules Stand-In",
    major: "Policy and Management",
    year: "Sophomore",
    ...ranks({ tech: 7, design: 5, finance: 4, events: 3, outreach: 1, labrador: 2, foundry: 6 }),
    ranking_explanation: "Outreach is the only one I actually want.",
    heard_about: "Word of mouth",
    ...DECLINE_ALL,
  },

  // 12. Every optional column blank. Nothing may be stored as an empty string.
  {
    timestamp: "2026-09-01 09:59:00",
    email: "kai@andrew.cmu.edu",
    full_name: "Kai Example",
    year: "Not sure yet",
    ...ranks({ tech: 1 }),
  },
];

async function buildFixture(): Promise<string> {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(SHEET_NAME);

  worksheet.addRow(FALL_2026_MAPPING.map((known) => known.header));
  for (const row of ROWS) {
    worksheet.addRow(FALL_2026_MAPPING.map((known) => row[known.key] ?? null));
  }

  const directory = dirname(fileURLToPath(import.meta.url));
  const target = join(directory, FIXTURE_FILENAME);
  await mkdir(directory, { recursive: true });

  await workbook.xlsx.writeFile(target);
  return target;
}

const written = await buildFixture();
process.stdout.write(
  `Wrote ${written} (${ROWS.length} rows, ${FALL_2026_MAPPING.length} columns)\n`,
);
