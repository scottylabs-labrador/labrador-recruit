import type {
  FieldRole,
  HeaderMapping,
  HeaderMatchKind,
  KnownHeader,
  MappedField,
} from "./types.ts";

/**
 * A header of the form `"<prefix> [<Label>]"`, which is how Google Forms
 * exports every grid question. The prefix is captured with `[\s\S]` rather than
 * `.` because the Foundry grid header contains real newlines.
 */
const BRACKETED_HEADER = /^([\s\S]*)\[([^\]]+)\]$/;

/**
 * Folds a header to a comparison key: lowercased, with every run of whitespace
 * (including the newlines inside the Foundry headers) collapsed to one space.
 * This is what lets a lightly re-worded or re-wrapped header still map, so an
 * admin does not have to repair the whole sheet because someone fixed a typo.
 */
export function normalizeHeaderKey(header: string): string {
  return header.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

/** `"Local Sponsorship"` -> `"local-sponsorship"`, matching db slug style. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

/** `"Local Sponsorship"` -> `"local_sponsorship"`, matching stable-key style. */
function keyify(label: string): string {
  return slugify(label).replaceAll("-", "_");
}

/**
 * The Fall 2026 Google Form, declared rather than coded. Adding, removing or
 * re-wording a question next cycle is an edit to this table; the normalisation
 * and validation code below never mentions a committee by name.
 *
 * Outreach appears only as a top-level ranking column: it has no question block
 * and needs none, because a committee with no questions is simply a committee
 * that contributes no `answer` fields.
 */
export const FALL_2026_MAPPING: readonly KnownHeader[] = [
  // --- General (columns 1-15) ---
  {
    header: "Timestamp",
    key: "timestamp",
    section: "general",
    answerType: "short_text",
    role: "identity",
  },
  {
    header: "Email Address",
    key: "email",
    section: "general",
    answerType: "short_text",
    role: "identity",
  },
  {
    header: "Full Name",
    key: "full_name",
    section: "general",
    answerType: "short_text",
    role: "identity",
  },
  {
    header: "Major(s) and any minors/concentrations",
    key: "major",
    section: "general",
    answerType: "short_text",
    role: "identity",
  },
  { header: "Year", key: "year", section: "general", answerType: "choice", role: "identity" },
  {
    header: "Committee Ranking [Tech]",
    key: "committee_rank_tech",
    section: "ranking",
    committeeSlug: "tech",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Design]",
    key: "committee_rank_design",
    section: "ranking",
    committeeSlug: "design",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Finance]",
    key: "committee_rank_finance",
    section: "ranking",
    committeeSlug: "finance",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Events]",
    key: "committee_rank_events",
    section: "ranking",
    committeeSlug: "events",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Outreach]",
    key: "committee_rank_outreach",
    section: "ranking",
    committeeSlug: "outreach",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Labrador]",
    key: "committee_rank_labrador",
    section: "ranking",
    committeeSlug: "labrador",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Committee Ranking [Foundry]",
    key: "committee_rank_foundry",
    section: "ranking",
    committeeSlug: "foundry",
    answerType: "rank",
    role: "committee_rank",
  },
  {
    header: "Please explain your committee rankings. Why are you interested in your top choices?",
    key: "ranking_explanation",
    section: "general",
    answerType: "long_text",
    role: "identity",
  },
  {
    header:
      "Are there any friends you would like to be placed with? " +
      "(This is not guaranteed, but we will try our best!)",
    key: "friend_request",
    section: "general",
    answerType: "long_text",
    role: "identity",
  },
  {
    header: "How did you hear about ScottyLabs?",
    key: "heard_about",
    section: "general",
    answerType: "short_text",
    role: "identity",
  },

  // --- Tech (opt-in + 2) ---
  {
    header: "Do you want to answer the Tech committee specific questions?",
    key: "tech_opt_in",
    section: "tech",
    committeeSlug: "tech",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "What is a technical project you are proud of, and what was your role in it?",
    key: "tech_project",
    section: "tech",
    committeeSlug: "tech",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What technologies are you most interested in learning or working with this semester?",
    key: "tech_interests",
    section: "tech",
    committeeSlug: "tech",
    answerType: "long_text",
    role: "answer",
  },

  // --- Labrador (opt-in + 8) ---
  {
    header: "Do you want to answer the Labrador committee specific questions?",
    key: "labrador_opt_in",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "Why are you interested in Labrador?",
    key: "labrador_interest",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What experience do you have with content creation, marketing, or community building?",
    key: "labrador_experience",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Describe a campus community you have helped grow.",
    key: "labrador_community",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What is your favorite ScottyLabs product or event, and how would you promote it?",
    key: "labrador_promotion",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "How much time can you commit to Labrador each week?",
    key: "labrador_commitment",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "short_text",
    role: "answer",
  },
  {
    header: "Social media link",
    key: "labrador_social_link",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Github link",
    key: "labrador_github_link",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Anything else you would like the Labrador committee to know?",
    key: "labrador_additional",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },

  // --- Foundry (opt-in + 17) ---
  {
    header: "Would you like to answer the Foundry specific questions",
    key: "foundry_opt_in",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header:
      "Pick your team\n\n*Note: this is a ranking, so 1st Choice is the team you most want. " +
      "[Talent]",
    key: "foundry_subteam_rank_talent",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "talent",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Pick your team\n\n*Note: this is a ranking, so 1st Choice is the team you most want. " +
      "[Accelerator]",
    key: "foundry_subteam_rank_accelerator",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "accelerator",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Pick your team\n\n*Note: this is a ranking, so 1st Choice is the team you most want. " +
      "[Outreach]",
    key: "foundry_subteam_rank_outreach",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "outreach",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header: "Why do you want to join Foundry?",
    key: "foundry_motivation",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What does entrepreneurship mean to you?",
    key: "foundry_entrepreneurship",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Describe a startup or product you admire and why.",
    key: "foundry_admired_product",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Have you ever built or launched something? Tell us about it.",
    key: "foundry_built",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What skills would you bring to the Foundry team?",
    key: "foundry_skills",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "How do you handle ambiguity and fast-changing priorities?",
    key: "foundry_ambiguity",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Describe a time you convinced someone to support an idea.",
    key: "foundry_persuasion",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What would you want to change about the CMU startup ecosystem?",
    key: "foundry_ecosystem",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "How many hours per week can you commit to Foundry?",
    key: "foundry_commitment",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "short_text",
    role: "answer",
  },
  {
    header: "Are you interested in the Talent team? If so, why?",
    key: "foundry_talent_interest",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Are you interested in the Accelerator team? If so, why?",
    key: "foundry_accelerator_interest",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Are you interested in the Outreach team? If so, why?",
    key: "foundry_outreach_interest",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Do you have experience with event planning or sponsorship outreach?",
    key: "foundry_event_experience",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Anything else you would like the Foundry committee to know?",
    key: "foundry_additional",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },

  // --- Finance (opt-in + 6 sub-team ranks + 4 free response) ---
  {
    header: "Do you want to answer the Finance committee specific questions?",
    key: "finance_opt_in",
    section: "finance",
    committeeSlug: "finance",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [Local Sponsorship]",
    key: "finance_subteam_rank_local_sponsorship",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "local-sponsorship",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [Documentation]",
    key: "finance_subteam_rank_documentation",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "documentation",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [University Relations]",
    key: "finance_subteam_rank_university_relations",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "university-relations",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [Purchasing + Planning]",
    key: "finance_subteam_rank_purchasing_planning",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "purchasing-planning",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [Sponsor Relations]",
    key: "finance_subteam_rank_sponsor_relations",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "sponsor-relations",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. Please rank from 1 " +
      "(most preferred) to 6 (least preferred). [Corporate Sponsorship]",
    key: "finance_subteam_rank_corporate_sponsorship",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "corporate-sponsorship",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header: "Why are you interested in the Finance committee?",
    key: "finance_motivation",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Describe any experience you have with budgeting, sponsorships, or vendor relations.",
    key: "finance_experience",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What is your approach to reaching out to a company you have no connection to?",
    key: "finance_outreach_approach",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Anything else you would like the Finance committee to know?",
    key: "finance_additional",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },

  // --- Events (opt-in + 6) ---
  {
    header: "Do you want to answer (not very) Events-specific questions?",
    key: "events_opt_in",
    section: "events",
    committeeSlug: "events",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "What is the best event you have ever attended, and what made it work?",
    key: "events_best_event",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "If you could run any event on campus, what would it be?",
    key: "events_dream_event",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Describe a time you had to solve a problem on short notice.",
    key: "events_problem_solving",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "How comfortable are you with talking to vendors and campus partners?",
    key: "events_comfort",
    section: "events",
    committeeSlug: "events",
    answerType: "short_text",
    role: "answer",
  },
  {
    header: "How many hours per week can you commit to Events?",
    key: "events_commitment",
    section: "events",
    committeeSlug: "events",
    answerType: "short_text",
    role: "answer",
  },
  {
    header: "Anything else you would like the Events committee to know?",
    key: "events_additional",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },

  // --- Design (opt-in + 2) ---
  {
    header: "Do you want to answer the Design committee specific questions?",
    key: "design_opt_in",
    section: "design",
    committeeSlug: "design",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "What kind of design are you most excited to work on?",
    key: "design_focus",
    section: "design",
    committeeSlug: "design",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Portfolio link",
    key: "design_portfolio_link",
    section: "design",
    committeeSlug: "design",
    answerType: "url",
    role: "answer",
  },
];

/**
 * A family of grid columns sharing one question stem, derived from the mapping
 * above rather than declared separately. This is what makes an eighth committee
 * -- or a seventh Foundry team -- import correctly with no code change: its
 * `Committee Ranking [X]` column matches the family by prefix and takes its
 * slug from the bracket.
 */
interface RankGroup {
  keyPrefix: string;
  section: string;
  committeeSlug: string | undefined;
  role: Extract<FieldRole, "committee_rank" | "subteam_rank">;
}

function buildRankGroups(): Map<string, RankGroup> {
  const groups = new Map<string, RankGroup>();

  for (const known of FALL_2026_MAPPING) {
    if (known.role !== "committee_rank" && known.role !== "subteam_rank") {
      continue;
    }
    const parts = BRACKETED_HEADER.exec(known.header.trim());
    const stem = parts?.[1];
    const label = parts?.[2];
    if (stem === undefined || label === undefined) {
      continue;
    }

    const suffix = `_${keyify(label)}`;
    if (!known.key.endsWith(suffix)) {
      continue;
    }

    const prefix = normalizeHeaderKey(stem);
    if (!groups.has(prefix)) {
      groups.set(prefix, {
        keyPrefix: known.key.slice(0, -suffix.length),
        section: known.section,
        committeeSlug: known.role === "committee_rank" ? undefined : known.committeeSlug,
        role: known.role,
      });
    }
  }

  return groups;
}

const RANK_GROUPS = buildRankGroups();

/** Matches a `"<known stem> [Label]"` header that no declared header covers. */
function matchRankGroup(header: string): KnownHeader | null {
  const parts = BRACKETED_HEADER.exec(header.trim());
  const stem = parts?.[1];
  const rawLabel = parts?.[2];
  if (stem === undefined || rawLabel === undefined) {
    return null;
  }

  const label = rawLabel.trim();
  const group = RANK_GROUPS.get(normalizeHeaderKey(stem));
  if (label === "" || group === undefined) {
    return null;
  }

  const base = {
    header,
    key: `${group.keyPrefix}_${keyify(label)}`,
    section: group.section,
    answerType: "rank",
  } as const;

  if (group.role === "committee_rank") {
    return { ...base, committeeSlug: slugify(label), role: "committee_rank" };
  }
  return {
    ...base,
    ...(group.committeeSlug === undefined ? {} : { committeeSlug: group.committeeSlug }),
    subteamKey: slugify(label),
    role: "subteam_rank",
  };
}

function buildLookups(): { exact: Map<string, KnownHeader>; folded: Map<string, KnownHeader> } {
  const exact = new Map<string, KnownHeader>();
  const folded = new Map<string, KnownHeader>();

  for (const known of FALL_2026_MAPPING) {
    if (!exact.has(known.header)) {
      exact.set(known.header, known);
    }
    const key = normalizeHeaderKey(known.header);
    if (!folded.has(key)) {
      folded.set(key, known);
    }
  }

  return { exact, folded };
}

const LOOKUPS = buildLookups();

/**
 * Matches a sheet's headers against the declared Fall 2026 form. Exact matches
 * win, then whitespace- and case-insensitive matches, then the generic bracket
 * families. Nothing throws: unrecognised and missing headers are returned so an
 * admin can repair the mapping in the UI, which is far better than refusing a
 * 118-row upload because somebody edited one question's punctuation.
 */
export function detectMapping(headers: string[]): HeaderMapping {
  const fields: MappedField[] = [];
  const unmappedHeaders: string[] = [];
  const matchedKeys = new Set<string>();
  const usedKeys = new Set<string>();

  for (const header of headers) {
    const exact = LOOKUPS.exact.get(header);
    const folded = LOOKUPS.folded.get(normalizeHeaderKey(header));

    let known: KnownHeader | null;
    let matchedBy: HeaderMatchKind;
    if (exact !== undefined) {
      known = exact;
      matchedBy = "exact";
    } else if (folded !== undefined) {
      known = folded;
      matchedBy = "normalized";
    } else {
      known = matchRankGroup(header);
      matchedBy = "pattern";
    }

    if (known === null) {
      unmappedHeaders.push(header);
      continue;
    }

    // Two sheet columns folding to one key would silently overwrite each other.
    if (usedKeys.has(known.key)) {
      unmappedHeaders.push(header);
      continue;
    }
    usedKeys.add(known.key);
    matchedKeys.add(known.key);
    fields.push({ ...known, header, matchedBy });
  }

  const missingHeaders = FALL_2026_MAPPING.filter((known) => !matchedKeys.has(known.key)).map(
    (known) => known.header,
  );

  return { fields, unmappedHeaders, missingHeaders };
}
