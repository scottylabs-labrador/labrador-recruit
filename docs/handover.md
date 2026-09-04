# Handover

Everything an engineer — or an agent working on their behalf — needs to take
this over. Read `docs/product-rules.md` first: it constrains what the platform
is allowed to do, and a change that violates it is a defect regardless of how
well it is written.

## What this is

Recruit is ScottyLabs' recruitment review platform. Leadership imports the
committee application form, reviewers score applicants against a published
rubric, and the platform reports arithmetic over those scores — means, medians,
spreads, reviewer disagreement, and a ranking. No model judges any applicant.

It is live and in use. As of 4 September 2026 the Fall 2026 cycle holds **118
applications, 378 candidacies, 9 reviewers and 85 Labrador candidacies**, each
with exactly two assigned reviewers.

## Live deployment

|                 |                                                               |
| --------------- | ------------------------------------------------------------- |
| Interface       | <https://web-production-8a3c.up.railway.app>                  |
| API             | <https://api-production-3c5ae.up.railway.app>                 |
| Railway project | "Labrador Recruiting", `f6ada88c-a401-42b5-a3f2-d5b99f7110d7` |
| `api` service   | `c21f548d-99ee-48ec-99be-48104d0dc1a2`                        |
| `web` service   | `7f465a41-1453-4613-83a9-ef0edbab7a94`                        |
| Database        | Neon Postgres, pooled connection                              |
| Repository      | `scottylabs-labrador/labrador-recruit` (private)              |

Deploys are manual, from a checkout on `main`:

```bash
railway up --service api --detach
railway up --service web --detach
```

Migrations run from the container's entrypoint (`apps/server/docker-entrypoint.sh`),
not from whoever is deploying. `set -e` means a failed migration kills the
container and Railway keeps the previous deployment serving, so traffic never
reaches a half-migrated database. This matters: an earlier deploy ran
`drizzle-kit migrate` from a laptop behind a firewall that blocked outbound
Postgres, it exited 0 having applied nothing, and the first request 500'd.

## Getting access

Nothing below is in this repository, and nothing below should ever be committed
to it. Secrets live in Railway's variable editor and in OpenBao. A credential
that appears in a commit, an issue, or a chat transcript has to be rotated.

| What                | How to grant it                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Repository          | GitHub → repo → Settings → Collaborators, or add them to the `scottylabs-labrador` org                     |
| Railway             | Railway → "Labrador Recruiting" → Settings → Members → invite by email                                     |
| OpenBao             | <https://bao.scottylabs.org> → "Sign in with OIDC Provider" → CMU credentials                              |
| Keycloak / Goldador | Add their Andrew ID to the project's team in Goldador's `inputs.json`, which provisions the Keycloak group |
| Neon                | Neon console → project → Settings → sharing, by email                                                      |

The person needs Railway membership to deploy and to read or set variables. They
do **not** need any secret pasted to them: everything they need is readable from
Railway's own variable editor once they are a member.

## Configuration

Names only. Values are in Railway; the descriptions in
`apps/server/secretspec.toml` say what breaks when each is wrong.

**Required on `api`:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`SERVER_URL`, `SERVER_PORT`, `ALLOWED_ORIGINS_REGEX`, `ADMIN_GROUP`,
`AUTH_ISSUER`, `AUTH_JWKS_URI`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`.

**Optional on `api`:** `AUTH_ALLOWED_GROUPS`, `PASSWORD_SIGN_IN`,
`GOOGLE_SERVICE_ACCOUNT_KEY`, `SHEET_SYNC_INTERVAL_MINUTES`, `GITHUB_ENRICHMENT`,
`SENTRY_DSN`.

**Required on `web`:** `VITE_SERVER_URL`. It is read at **build** time, so
changing it needs a redeploy, not a restart.

Two traps, both of which cost real time:

- Setting a variable whose value contains a backslash from Git Bash silently
  rewrites it. `ALLOWED_ORIGINS_REGEX` became `web-production/.up/.railway/.app`
  that way; CORS then withheld the origin header and only a browser noticed.
  Set anything with backslashes from PowerShell or the Railway UI.
- `railway variables --unset` does not exist. It is `railway variable delete KEY --service api`.

## How people sign in

Today: Andrew ID and password, because no OIDC client is registered for this
deployment. `AUTH_CLIENT_ID` is the sentinel `not-yet-registered`, and
`/auth/config` reports that so the interface withholds a single sign-on button
that would only fail at Keycloak.

`PASSWORD_SIGN_IN` defaults to `auto`, meaning passwords work **only** while
that sentinel is in place. Registering a real client switches them off in the
same change, which is the point: the passwords issued in this window are shared
temporary credentials and would otherwise be a way around the group gate below.

Once an OIDC client exists, the realm brokers straight to CMU SAML with no local
login form, so every Andrew ID at the university can authenticate. Access is
therefore decided by **Goldador group membership**: `AUTH_ALLOWED_GROUPS` names
the groups allowed in, `ADMIN_GROUP` is always allowed on top, and anyone whose
`groups` claim carries neither is refused with an explanation. Adding a reviewer
is a Goldador change and nothing here — they sign in and are provisioned on
first login.

If single sign-on misbehaves, setting `AUTH_CLIENT_ID` back to
`not-yet-registered` restores password sign-in immediately. That escape hatch is
why the group gate can safely fail closed.

## Working on it

```bash
bun install
bun run dev            # api on :8080, web on :3000
bun run quality        # syncpack, markdownlint, oxfmt, oxlint
bunx turbo run test    # 662 tests
```

`bun run dev:login` mints a local session; it is deliberately a script and not
an HTTP endpoint, so no deployment can ever expose it.

Notes that will save an afternoon:

- The full test run takes about six minutes. Run one package while iterating.
- The review page is the heaviest render in the suite at ~15s on its own, and
  the async ceiling is 45s because `turbo run test` puts the server suite on the
  same machine. That is headroom for a slow render, not a fix for it.
- `tsc --noEmit` reports two pre-existing `TS2883` errors in `app.ts` and
  `db.ts` about non-portable inferred types. They are on `main` and unrelated to
  any recent change.
- Commit messages are linted by commitlint. `deploy` is not a valid type; use
  `feat`, `fix`, `ci`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`,
  `build`, `revert`.

## Architecture

Bun workspaces and Turborepo. `apps/server` is Express 5 with tsoa generating
the OpenAPI spec; `apps/web` is React 19 with TanStack Router and Query.
`packages/db` holds the Drizzle schema and migrations, `packages/access-control`
holds CASL abilities compiled into Drizzle `WHERE` clauses, `packages/common`
holds the scoring and ranking arithmetic.

The type chain matters: **changing a controller means regenerating the client
types**, or the web build fails against a stale schema.

```bash
bun run build --filter=@labrador/server   # regenerates swagger.d.ts
```

Authorisation is one rule expressed once. `visibleApplicationWhere` in
`applicantService.ts` is exported and reused rather than restated — a second
copy of a visibility rule is a second place for it to drift, and that one
decides who may read an applicant's work.

## Operational notes

**Reviewer assignment.** Every candidacy carries two reviewers. There are also
255 cancelled assignment rows from an earlier redistribution: the unique index
on `(candidacy, reviewer)` covers cancelled rows too, so reassigning somebody
who was previously cancelled returns 409. That is unfixed debt; it needs a
partial index or a status-aware constraint.

**Cycle status** is cosmetic apart from `archived`, which makes a cycle
read-only. Fall 2026 currently sits in `draft` while being actively reviewed.

**The audit log** is readable by any member of the cycle, not just leadership —
`listAuditEvents` deliberately reuses the cycle read check. It carries no
applicant identity, but a reviewer can see who exported decisions and who
changed settings. Confirm that is intended before treating it as settled.

**Sheet sync** stages a preview and stops. A scheduled pull that committed
itself would rewrite applicant records with nobody watching. Committing stays a
named act on the Import screen. To switch it on: create a Google service
account, share the sheet with its `client_email` as a viewer, put the key JSON
in `GOOGLE_SERVICE_ACCOUNT_KEY`, and set `SHEET_SYNC_INTERVAL_MINUTES`.

**GitHub enrichment** is off unless `GITHUB_ENRICHMENT=on`, because fetching an
applicant-provided link at all is a carve-out from product rule 1. It is
unauthenticated, so the budget is 60 requests an hour for the whole deployment —
which is why nothing is ever fetched during a page render, why the background
pass is capped at 40 an hour, and why it stops dead on the first rate-limit
response.

**Both schedules are in-process timers** and assume a single replica. Railway's
scheduled-job settings are not reachable from its CLI on this account, which is
the same limitation that put migrations in the entrypoint. Move them to a real
scheduler before scaling the API out.

## Outstanding

- `recruit.scottylabs.org` and `api.recruit.scottylabs.org` do not exist. The
  Keycloak client `labrador-recruit-prod` accepts **only**
  `https://api.recruit.scottylabs.org/api/auth/oauth2/callback/keycloak`, so
  single sign-on is blocked on those DNS records plus a Railway custom domain.
  The account used so far cannot add custom domains — that needs a higher
  Railway role.
- The prod OIDC client secret is not retrievable from OpenBao. Goldador derives
  the secret path with `split("-", client_id)[0]` and `[1]`, so for a hyphenated
  slug every environment collapses onto one path: all four of our clients write
  to `labrador/generated/recruit` and overwrite each other, and the survivor is
  the `-local` client. Fix Goldador, or read the secret from the Keycloak admin
  console.
- Final placement has working endpoints and no interface. It resolves an
  applicant admitted by several committees, which is meaningless while the cycle
  is scoped to Labrador alone.
- Event attendance import is unstarted, waiting on a spreadsheet.

## Where to look

| Concern                           | File                                        |
| --------------------------------- | ------------------------------------------- |
| What the platform may not do      | `docs/product-rules.md`                     |
| Deploying, identity provider, DNS | `docs/deployment.md`                        |
| Running a cycle                   | `docs/running-a-cycle.md`                   |
| Local setup                       | `docs/local-development.md`                 |
| Architecture and decisions        | `docs/architecture.md`, `docs/adr/`         |
| Permissions                       | `packages/access-control/src/abac.ts`       |
| Import pipeline                   | `apps/server/src/services/importService.ts` |
| Column mapping for the form       | `apps/server/src/lib/import/headerMap.ts`   |
