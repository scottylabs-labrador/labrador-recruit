# Deployment

Railway, in the ScottyLabs project **Labrador Recruiting**, at
<https://labrador-recruit-production.up.railway.app>.

Three resources, defined in code in [`.railway/railway.ts`](../.railway/railway.ts):

| Resource                  | What it is                                                                      |
| ------------------------- | ------------------------------------------------------------------------------- |
| `labrador-recruit`        | The interface, on Caddy. The only public address.                               |
| `labrador-recruit-server` | The API. Private network only, port 8080.                                       |
| `Postgres`                | Railway Postgres, with `postgres-volume` mounted at `/var/lib/postgresql/data`. |

## One origin, not two

The API has no public address. `apps/web/Caddyfile` reverse-proxies the API's
own paths through the interface's origin, so the browser only ever talks to one
host.

This is a departure from ScottyStack, which publishes the interface and the API
on sibling hosts. That works there because both sit under `scottylabs.org`, so
a cookie set by one is same-site for the other. `up.railway.app` is on the
Public Suffix List, which makes two Railway subdomains different _sites_ — and a
session cookie between them is a third-party cookie, which Safari blocks
outright. Sign-in would return 200 and the application would behave as though
nobody had signed in.

One origin also means `SameSite=Lax` and no CORS at all. Moving to a real domain
such as `recruit.scottylabs.org` would make the two-service layout viable again,
but would not make it preferable.

## Migrations

`apps/server/docker-entrypoint.sh` applies them when the container starts, then
execs the server. `set -e` means a failed migration kills the container and
Railway keeps the previous deployment serving, so traffic never reaches a
half-migrated database.

Deliberately _not_ Railway's `preDeployCommand`, which the ScottyStack template
uses: the two together ran the same migration twice per deploy and gave it two
different places to fail.

## Changing the infrastructure

Edit `.railway/railway.ts`, then:

```bash
railway config plan     # read-only; shows exactly what would change
railway config apply    # asks before applying
```

`plan` should report "already up to date" against a clean checkout. If it wants
to change something you did not change, Railway drifted — reconcile before
applying anything else.

On Windows the IaC engine shells out to `$_` for its CLI version check, which
Git Bash sets to something else and PowerShell leaves unset. If `plan` claims
the CLI is too old, run it as:

```bash
RW="$APPDATA/npm/node_modules/@railway/cli/bin/railway.exe"
env _="$RW" "$RW" config plan
```

## The previous deployment

Vercel and Neon. `vercel.json`, `api/index.ts` and `apps/server/src/vercelEntry.ts`
still work and are still in the repository. Nothing reads them on Railway, which
builds from `apps/*/Dockerfile`. Delete them once Railway has carried a cycle.

One behavioural difference worth knowing: the in-process timers in `server.ts`
(sheet sync, GitHub refresh) never ran on Vercel, which has no long-running
process. On Railway they do, so `SHEET_SYNC_INTERVAL_MINUTES` now has an effect.

## Before you start

- Railway access to the ScottyLabs workspace, and `railway login`.
- Railway CLI **5.42.1 or newer** — `railway config` does not exist before that,
  and the IaC engine now ships in the CLI rather than the npm SDK.
- **Never paste a secret into a chat, an issue, or a commit.** Put it straight
  into Railway's variable editor. A secret that appears in a transcript has to be
  rotated.

## Environment

Everything below is set by `.railway/railway.ts` except the three noted, which
Railway holds and the file only preserves.

| Variable                | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| `DATABASE_URL`          | `${{Postgres.DATABASE_URL}}` — the Railway Postgres       |
| `SERVER_URL`            | the public origin; Better Auth builds callbacks from it   |
| `BETTER_AUTH_URL`       | the same origin                                           |
| `VITE_SERVER_URL`       | the same origin again, on the **web** service             |
| `API_ORIGIN`            | `http://labradorrecruitserver.railway.internal:8080`      |
| `SERVER_PORT`           | `8080`, pinned so `API_ORIGIN` can name it                |
| `ALLOWED_ORIGINS_REGEX` | anchored to the public origin                             |
| `ADMIN_GROUP`           | `labrador-recruit-admins`                                 |
| `AUTH_ALLOWED_GROUPS`   | `labrador-recruit`                                        |
| `AUTH_ISSUER`           | `https://idp.scottylabs.org/realms/labrador`              |
| `AUTH_JWKS_URI`         | the realm's JWKS endpoint                                 |
| `AUTH_CLIENT_ID`        | `not-yet-registered` until an OIDC client exists          |
| `AUTH_CLIENT_SECRET`    | `not-yet-registered` until an OIDC client exists          |
| `PASSWORD_SIGN_IN`      | `auto`                                                    |
| `GITHUB_ENRICHMENT`     | `off`                                                     |
| `BETTER_AUTH_SECRET`    | **held by Railway**, generated once; `preserve()` in code |
| `SENTRY_DSN`            | **held by Railway**, optional                             |
| `VITE_PUBLIC_POSTHOG_*` | **held by Railway**, optional                             |

Two of these are load-bearing in ways that are easy to get wrong.

**Both `AUTH_CLIENT_*` must be strings, always.** `env.ts` requires them, so
`preserve()` on a variable that has never been set leaves it `undefined` and the
server dies on its own environment validation _after_ migrating the database —
which looks like a database problem and is not one.

**`VITE_SERVER_URL` is read at build time**, not run time. Vite bakes it into the
bundle, so changing it needs a rebuild of the web service, not a restart.

## Accounts

Sign-in is by Andrew ID and password. Registration is closed: the Andrew ID is
the primary key every membership, assignment and review points at, so it is
granted by an administrator rather than asserted by whoever fills in a form.

The first account has to come from outside the application, because the admin
endpoint needs an administrator to call it:

```bash
railway service labrador-recruit-server
railway run bun run apps/server/scripts/createAccount.ts <andrewId> "Full Name" --admin
```

`railway run` injects the service's production variables into a local process,
so `DATABASE_URL` points at the Railway Postgres. Run it in a terminal you are
willing to have the temporary password printed into — not one whose output is
being recorded.

It prints a temporary password once; it is not recoverable. After that, an
administrator can create accounts over the API:

```text
POST /admin/users                      { andrewId, name, role }
POST /admin/users/{andrewId}/reset-password
```

A temporary password blocks every screen until the person replaces it. Whoever
issued it knows it, and it probably travelled through a chat message to get
there.

## Moving to the ScottyLabs identity provider

Nothing in the application changes. Register the client in
[Goldador](https://scottylabs-labrador.github.io/goldador/), which puts its id
and secret in OpenBao, then set `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` on the
deployment. Register this redirect URI in Keycloak, or sign-in fails after the
user has already authenticated, which is the most confusing possible moment:

```text
https://<domain>/api/auth/oauth2/callback/keycloak
```

That path comes from the `genericOAuth` provider id in
`apps/server/src/lib/auth.ts`. Changing `providerId` changes the callback URL.

### Who is allowed in

The realm has no local login form: the authorize endpoint redirects straight to
a single CMU SAML provider, so every Andrew ID at the university authenticates
successfully. Access is therefore decided by Goldador group membership, not by
authentication.

`infra/keycloak/teams.tf` in Goldador puts every `teams[<slug>].members.andrew_ids`
into a Keycloak group named after the slug, every admin into `<slug>-admins`, and
emits both in a `groups` claim. Set `AUTH_ALLOWED_GROUPS` to the slug. Anyone
whose claim carries none of the allowed groups is refused with an explanation.
`ADMIN_GROUP` is always allowed on top of the list, so a mistyped value degrades
to admins-only rather than locking everybody out.

Adding a reviewer is a Goldador change, nothing here: they sign in and are
provisioned on first login.

### Password accounts stop working

`PASSWORD_SIGN_IN` defaults to `auto`, which means Andrew ID and password work
only while `AUTH_CLIENT_ID` is still `not-yet-registered`. Registering a client
switches them off in the same change.

That is deliberate rather than tidy-minded. Password accounts exist so a cycle
can run before an identity provider does, and the passwords issued in that
window are shared temporary credentials; leaving them enabled afterwards would
be a way around the group gate above. The global role still prefers the `groups`
claim and falls back to the role stored on the user row, so the accounts
themselves keep their access - they just cannot be signed into with a password.

If single sign-on turns out to be misconfigured, returning `AUTH_CLIENT_ID` to
`not-yet-registered` restores password sign-in immediately. That is the escape
hatch, and it is why the group gate can safely fail closed.

### The generated secret is not where the path suggests

Goldador derives the OpenBao path from the client id by splitting on `-`:

```hcl
slug = split("-", client_id)[0]
env  = split("-", client_id)[1]
```

For a hyphenated slug such as `labrador-recruit` that yields `slug = "labrador"`
and `env = "recruit"` for _every_ environment, so all four clients
(`-local`, `-dev`, `-staging`, `-prod`) write to the single path
`labrador/generated/recruit` and overwrite each other. Whichever applies last
wins, which is why that path holds the **local** client's credentials and there
is no `prod` entry at all.

Until Goldador is fixed, read the prod client's secret from the Keycloak admin
console rather than OpenBao. Fixing it means keeping all but the last segment as
the slug and the last as the environment.

## Deploys

Both services build from `main` on push, each with its own `watchPatterns`, so a
change under `apps/web` does not rebuild the API and vice versa. Both watch
`packages/**`, because either can be affected by a change there.

Infrastructure changes are separate and manual — `.railway/railway.ts` is applied
with `railway config apply`, not by pushing. To pin that to CI instead, produce
the plan on the pull request and apply the reviewed file on merge:

```bash
railway config plan --out railway-plan.json
railway config apply --plan railway-plan.json --yes --confirm-destructive
```

CI (`.github/workflows/check.yml`) runs the full gate on every push and does not
deploy.
