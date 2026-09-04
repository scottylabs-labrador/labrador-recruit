import { normalizeUrl } from "../import/normalize.ts";

const API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

/** How many repositories are kept. The review page shows the top five. */
const KEEP_REPOS = 5;

/**
 * One repository, exactly as GitHub describes it.
 *
 * Every field is a fact GitHub states or the applicant wrote themselves.
 * `docs/product-rules.md` §1 permits precisely this list and nothing derived
 * from it - no summary, no score, no characterisation.
 */
export interface GithubRepo {
  name: string;
  /** The applicant's own description, not ours. Null when they wrote none. */
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  url: string;
}

export type GithubFetchResult =
  | { ok: true; repos: GithubRepo[] }
  | { ok: false; error: string; httpStatus: number | null; rateLimited: boolean };

/**
 * The GitHub account named by a link the applicant supplied, or null.
 *
 * Reuses `normalizeUrl`, which shape-checks a URL without resolving it, then
 * requires the host to be GitHub and takes the first path segment. Anything
 * else - a gist, an organisation page, a different host - yields null rather
 * than a guess, because a wrong username fetches a stranger's repositories and
 * shows them beside somebody's application.
 */
export function githubUsername(rawLink: string | null | undefined): string | null {
  if (rawLink === null || rawLink === undefined) {
    return null;
  }

  const normalized = normalizeUrl(rawLink);
  if (normalized === null) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }

  const [first, ...rest] = parsed.pathname.split("/").filter((part) => part !== "");
  if (first === undefined) {
    return null;
  }
  // A link to a specific repository still names its owner, which is who we
  // want; anything deeper than owner/repo is a file or a page, not an account.
  if (rest.length > 1) {
    return null;
  }

  // GitHub usernames are alphanumeric with single hyphens, up to 39 characters.
  // Reserved paths like "orgs" or "settings" fail this or are not accounts.
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/u.test(first)) {
    return null;
  }

  return first;
}

/** The five repositories worth showing: most starred, then most recently pushed. */
export function topRepos(repos: GithubRepo[]): GithubRepo[] {
  return [...repos]
    .sort((a, b) => {
      if (b.stars !== a.stars) {
        return b.stars - a.stars;
      }
      return (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");
    })
    .slice(0, KEEP_REPOS);
}

interface RawRepo {
  name?: unknown;
  description?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  pushed_at?: unknown;
  html_url?: unknown;
  fork?: unknown;
}

/** Keeps only the permitted fields, discarding everything else GitHub sends. */
export function toRepos(payload: unknown): GithubRepo[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry): GithubRepo[] => {
    const raw = entry as RawRepo;
    if (typeof raw.name !== "string" || typeof raw.html_url !== "string") {
      return [];
    }
    // A fork is somebody else's work. Showing it under "what they built" would
    // be misleading in exactly the way this feature is meant to avoid.
    if (raw.fork === true) {
      return [];
    }
    return [
      {
        name: raw.name,
        description: typeof raw.description === "string" ? raw.description : null,
        language: typeof raw.language === "string" ? raw.language : null,
        stars: typeof raw.stargazers_count === "number" ? raw.stargazers_count : 0,
        pushedAt: typeof raw.pushed_at === "string" ? raw.pushed_at : null,
        url: raw.html_url,
      },
    ];
  });
}

/**
 * Reads an account's public repositories.
 *
 * Unauthenticated, which is 60 requests per hour for the whole deployment. That
 * budget is why nothing here is called while a page renders: a reviewer opening
 * ten applicants would spend a sixth of an hour's allowance on one sitting.
 *
 * Every failure is an ordinary outcome with a reason a reviewer can read. A
 * deleted account, a private one and an exhausted budget are all things that
 * simply happen, and none of them is an error state on the review page.
 */
export async function fetchRepos(username: string): Promise<GithubFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${API}/users/${encodeURIComponent(username)}/repos?per_page=100`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      error: "GitHub could not be reached",
      httpStatus: null,
      rateLimited: false,
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      error: "No public GitHub account with that name",
      httpStatus: 404,
      rateLimited: false,
    };
  }

  // GitHub answers an exhausted unauthenticated budget with 403 or 429 and a
  // remaining count of zero. Distinguished from a genuine refusal because the
  // refresher must stop rather than burn through retries.
  const remaining = response.headers.get("x-ratelimit-remaining");
  if ((response.status === 403 || response.status === 429) && remaining === "0") {
    return {
      ok: false,
      error: "GitHub's hourly limit for this deployment is used up",
      httpStatus: response.status,
      rateLimited: true,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `GitHub returned ${String(response.status)}`,
      httpStatus: response.status,
      rateLimited: false,
    };
  }

  try {
    return { ok: true, repos: topRepos(toRepos(await response.json())) };
  } catch {
    return {
      ok: false,
      error: "GitHub's response could not be read",
      httpStatus: response.status,
      rateLimited: false,
    };
  }
}
