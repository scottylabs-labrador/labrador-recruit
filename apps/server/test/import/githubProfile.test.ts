import { describe, expect, it } from "vitest";

import {
  type GithubRepo,
  githubUsername,
  topRepos,
  toRepos,
} from "../../src/lib/github/githubProfile.ts";

/**
 * Fetching an applicant-provided link is a carve-out from product rule 1, drawn
 * around github.com and verbatim facts only. Getting the username wrong would
 * fetch a stranger's repositories and print them beside somebody's application,
 * so anything ambiguous yields null rather than a guess.
 */
describe("githubUsername", () => {
  it("reads a profile link", () => {
    expect(githubUsername("https://github.com/octocat")).toBe("octocat");
    expect(githubUsername("http://www.github.com/octocat/")).toBe("octocat");
  });

  /** A link to one repository still names its owner, which is who we want. */
  it("reads the owner out of a repository link", () => {
    expect(githubUsername("https://github.com/octocat/hello-world")).toBe("octocat");
  });

  it("accepts a bare github.com link the applicant typed without a scheme", () => {
    expect(githubUsername("github.com/octocat")).toBe("octocat");
  });

  /** The carve-out is github.com and nothing else. */
  it("refuses any other host", () => {
    expect(githubUsername("https://gitlab.com/octocat")).toBeNull();
    expect(githubUsername("https://linkedin.com/in/octocat")).toBeNull();
    expect(githubUsername("https://notgithub.com/octocat")).toBeNull();
  });

  /** Deeper than owner/repo is a file or a page, not an account. */
  it("refuses a link into a repository's contents", () => {
    expect(githubUsername("https://github.com/octocat/hello-world/blob/main/README.md")).toBeNull();
  });

  it("refuses github.com itself, with no account named", () => {
    expect(githubUsername("https://github.com")).toBeNull();
    expect(githubUsername("https://github.com/")).toBeNull();
  });

  it("refuses a name that is not shaped like a GitHub account", () => {
    expect(githubUsername("https://github.com/-leading-hyphen")).toBeNull();
    expect(githubUsername("https://github.com/double--hyphen")).toBeNull();
    expect(githubUsername(`https://github.com/${"a".repeat(40)}`)).toBeNull();
  });

  /** Plenty of applicants leave the optional field blank or write prose in it. */
  it("reads a blank or unparseable answer as no account", () => {
    expect(githubUsername(null)).toBeNull();
    expect(githubUsername(undefined)).toBeNull();
    expect(githubUsername("")).toBeNull();
    expect(githubUsername("n/a")).toBeNull();
    expect(githubUsername("I do not have one")).toBeNull();
  });
});

describe("toRepos", () => {
  const raw = [
    {
      name: "hello-world",
      description: "My first repository",
      language: "TypeScript",
      stargazers_count: 12,
      pushed_at: "2026-08-01T00:00:00Z",
      html_url: "https://github.com/octocat/hello-world",
      fork: false,
      // Fields the rules do not permit us to keep.
      watchers_count: 400,
      owner: { login: "octocat" },
    },
  ];

  it("keeps only the fields the rules permit", () => {
    const [repo] = toRepos(raw);

    expect(repo).toEqual({
      name: "hello-world",
      description: "My first repository",
      language: "TypeScript",
      stars: 12,
      pushedAt: "2026-08-01T00:00:00Z",
      url: "https://github.com/octocat/hello-world",
    });
  });

  /**
   * A fork is somebody else's work. Showing it under what an applicant built
   * would mislead in exactly the way this feature exists to avoid.
   */
  it("drops forks", () => {
    expect(toRepos([{ ...raw[0], fork: true }])).toHaveLength(0);
  });

  it("survives a repository missing the fields it needs", () => {
    expect(toRepos([{ description: "no name or url" }])).toHaveLength(0);
    expect(toRepos([{ name: "x", html_url: "u" }])[0]?.stars).toBe(0);
    expect(toRepos([{ name: "x", html_url: "u" }])[0]?.description).toBeNull();
  });

  it("reads a non-list response as no repositories", () => {
    expect(toRepos(null)).toEqual([]);
    expect(toRepos({ message: "Not Found" })).toEqual([]);
  });
});

describe("topRepos", () => {
  function repo(name: string, stars: number, pushedAt: string): GithubRepo {
    return { name, description: null, language: null, stars, pushedAt, url: `u/${name}` };
  }

  it("takes the five most starred", () => {
    const chosen = topRepos([
      repo("a", 1, "2026-01-01"),
      repo("b", 9, "2026-01-01"),
      repo("c", 5, "2026-01-01"),
      repo("d", 7, "2026-01-01"),
      repo("e", 3, "2026-01-01"),
      repo("f", 8, "2026-01-01"),
    ]);

    expect(chosen.map((r) => r.name)).toEqual(["b", "f", "d", "c", "e"]);
  });

  /** Stars are sparse among students, so recency breaks the many ties. */
  it("breaks ties on the most recent push", () => {
    const chosen = topRepos([
      repo("older", 0, "2025-01-01T00:00:00Z"),
      repo("newer", 0, "2026-06-01T00:00:00Z"),
    ]);

    expect(chosen.map((r) => r.name)).toEqual(["newer", "older"]);
  });

  it("copes with a repository that has never been pushed to", () => {
    const chosen = topRepos([repo("never", 0, ""), repo("once", 0, "2026-01-01T00:00:00Z")]);
    expect(chosen[0]?.name).toBe("once");
  });
});
