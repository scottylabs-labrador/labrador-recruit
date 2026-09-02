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
  // --- General (columns 1-16) ---
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
    header:
      "Please use this space to explain your rankings above (prior experience, strong " +
      "interests, etc). You will be more likely to be assigned your top choices if you do so :)",
    key: "ranking_explanation",
    section: "general",
    answerType: "long_text",
    role: "identity",
  },
  {
    header: "Are there any friends who you want to be in the same committee as?",
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
  // Pure form routing: this only decided which question blocks the applicant
  // was shown, and the ranking columns already record the same thing exactly.
  {
    header: "Did you select either Tech or Labrador in your top three options?",
    key: "tech_or_labrador_routing",
    section: "general",
    answerType: "choice",
    role: "ignored",
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
    header: "What's something technical you worked on recently that you're particularly proud of?",
    key: "tech_project",
    section: "tech",
    committeeSlug: "tech",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "After looking through the projects page, what team(s)/project(s) stand out most to you? " +
      "What do you hope to contribute to them?",
    key: "tech_projects_of_interest",
    section: "tech",
    committeeSlug: "tech",
    answerType: "long_text",
    role: "answer",
  },

  // --- Labrador (opt-in + 7) ---
  {
    header: "Do you want to answer the Labrador committee specific questions?",
    key: "labrador_opt_in",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "What idea do you want to work on in the committee?",
    key: "labrador_idea",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "Are you interested in a technical role (e.g. backend developer) or a non-technical role " +
      "(e.g. team lead)? Describe your previous experience in your chosen role type.",
    key: "labrador_role_preference",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Why are you excited about Labrador?",
    key: "labrador_interest",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What makes you a good candidate for the committee?",
    key: "labrador_fit",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Social media link (personal website, LinkedIn, etc.)",
    key: "labrador_social_link",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Github link (optional: only if technical)",
    key: "labrador_github_link",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Other comments/questions",
    key: "labrador_additional",
    section: "labrador",
    committeeSlug: "labrador",
    answerType: "long_text",
    role: "answer",
  },

  // --- Foundry (opt-in + 18) ---
  // Only `foundry_opt_in` is a committee gate. The analyst and builder
  // questions below are sub-questions of that block, so they are answers:
  // `committeeOptIns` is keyed by committee and last write wins, and marking
  // them `opt_in` let a "No" to the analyst track silently retract a "Yes" to
  // Foundry itself - which cost two applicants their Foundry candidacy.
  {
    header: "Would you like to answer the Foundry specific questions",
    key: "foundry_opt_in",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header: "What type of membership?",
    key: "foundry_membership_type",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "choice",
    role: "answer",
  },
  {
    header: "Why are you interested in Entrepreneurship?",
    key: "foundry_entrepreneurship",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What are you building or hoping to build?",
    key: "foundry_building",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Are you looking for cofounders?",
    key: "foundry_cofounders",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "choice",
    role: "answer",
  },
  {
    header: "What have you built, run, or shipped that nobody assigned you? Link it if it exists.",
    key: "foundry_self_directed",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "LinkedIn (Optional)",
    key: "foundry_linkedin",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Website Portfolio (Optional)",
    key: "foundry_portfolio",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "url",
    role: "answer",
  },
  {
    header: "Would you also like to answer the Foundry analyst member questions?",
    key: "foundry_analyst_opt_in",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "choice",
    role: "answer",
  },
  {
    header:
      "Pick your team\n\n*Note: If you mark your interest as an Accelerator team member, you " +
      "will also be required to give an interview to join the team. [Talent]",
    key: "foundry_subteam_rank_talent",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "talent",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Pick your team\n\n*Note: If you mark your interest as an Accelerator team member, you " +
      "will also be required to give an interview to join the team. [Accelerator]",
    key: "foundry_subteam_rank_accelerator",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "accelerator",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Pick your team\n\n*Note: If you mark your interest as an Accelerator team member, you " +
      "will also be required to give an interview to join the team. [Outreach]",
    key: "foundry_subteam_rank_outreach",
    section: "foundry",
    committeeSlug: "foundry",
    subteamKey: "outreach",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header: "Describe your experience with Startups/VC's",
    key: "foundry_startup_experience",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "Pitch us a unique speaker series or event format that would get 100 CMU students in a " +
      "room who wouldn't otherwise show up.",
    key: "foundry_event_pitch",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "What is a venture capital firm you follow? Describe their investment strategy (thesis) " +
      "and why you find it interesting.",
    key: "foundry_vc_thesis",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "Identify one early-stage startup (Seed or Series A) you believe has high potential. " +
      "Explain your thesis.",
    key: "foundry_startup_thesis",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Would you also like to answer the Foundry builder member questions?",
    key: "foundry_builder_opt_in",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "choice",
    role: "answer",
  },
  {
    header: "Do you want to apply to our Foundry Builder or Analyst Member?",
    key: "foundry_track",
    section: "foundry",
    committeeSlug: "foundry",
    answerType: "choice",
    role: "answer",
  },

  // --- Finance (opt-in + 6 sub-team ranks + 4 free response) ---
  {
    header: "Do you want to answer Finance specific questions?",
    key: "finance_opt_in",
    section: "finance",
    committeeSlug: "finance",
    answerType: "boolean",
    role: "opt_in",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[Local Sponsorship]",
    key: "finance_subteam_rank_local_sponsorship",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "local-sponsorship",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[Documentation]",
    key: "finance_subteam_rank_documentation",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "documentation",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[University Relations]",
    key: "finance_subteam_rank_university_relations",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "university-relations",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[Purchasing + Planning]",
    key: "finance_subteam_rank_purchasing_planning",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "purchasing-planning",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[Sponsor Relations]",
    key: "finance_subteam_rank_sponsor_relations",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "sponsor-relations",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header:
      "Rank your preference for which team you'd like to be in. We will try our best to " +
      "accommodate everyone into their top choice, but we cannot guarantee placements. " +
      "[Corporate Sponsorship]",
    key: "finance_subteam_rank_corporate_sponsorship",
    section: "finance",
    committeeSlug: "finance",
    subteamKey: "corporate-sponsorship",
    answerType: "rank",
    role: "subteam_rank",
  },
  {
    header: "Which fruit most represents you and why?",
    key: "finance_fruit",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Best bad idea you tried?",
    key: "finance_bad_idea",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What's your hottest take?",
    key: "finance_hot_take",
    section: "finance",
    committeeSlug: "finance",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Anything else you'd like to share with us? You can leave this blank if you wish.",
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
    header: "Where is Waldo?",
    key: "events_waldo",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What's something you did recently you're proud of?",
    key: "events_proud_of",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "What are you adding to the TartanHacks Opening Ceremony playlist?",
    key: "events_opening_playlist",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header:
      "TartanHacks just wrapped up (it's almost midnight). What are you listening to on your " +
      "way home?",
    key: "events_closing_playlist",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "Why do you do what you do?",
    key: "events_motivation",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },
  {
    header: "If you wrote these questions, what would you do differently?",
    key: "events_question_critique",
    section: "events",
    committeeSlug: "events",
    answerType: "long_text",
    role: "answer",
  },

  // --- Design (opt-in + 2) ---
  {
    header: "Do you want to answer Design specific questions?",
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
    header: "Portfolio link (optional but highly recommended!)",
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
 * Whether the declared form knows this header at all, by any of the three match
 * kinds `detectMapping` uses. Exists so a caller can weigh one worksheet
 * against another before committing to parse either.
 */
export function isKnownHeader(header: string): boolean {
  return (
    LOOKUPS.exact.has(header) ||
    LOOKUPS.folded.has(normalizeHeaderKey(header)) ||
    matchRankGroup(header) !== null
  );
}

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
