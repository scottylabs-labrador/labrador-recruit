# Deployment

One Vercel project serves both the interface and the API, with Postgres on Neon.

Serving both from one deployment makes them same-origin. That is not only
tidiness: a split deployment needs a `SameSite=None` session cookie and a CORS
allowlist, and both were a source of quiet, confusing failures where sign-in
appeared to succeed and the application behaved as though nobody had signed in.

## Before you start

- A Vercel account, and `vercel login`.
- A Neon account, and `neonctl auth`.
- **Never paste a secret into a chat, an issue, or a commit.** Put it straight
  into Vercel's environment editor. A secret that appears in a transcript has to
  be rotated — or, if the thing it protects is disposable, replaced outright.

## Database

```bash
neonctl projects create --name labrador-recruit --org-id <your-org>
neonctl connection-string --project-id <project-id> --pooled
```

Use the **pooled** connection string. Serverless functions open a connection per
invocation and a direct endpoint runs out of them under any real load.

Run the migrations before the first deploy:

```bash
cd packages/db && DATABASE_URL="<pooled-url>" bunx drizzle-kit migrate
```

## Vercel project

Create the project without letting the CLI autodetect a framework — it
recognises the Express dependency and writes a `services` block that does not
apply here:

```bash
vercel project add labrador-recruit-app
vercel link --yes --project labrador-recruit-app
vercel deploy --prod
```

`vercel.json` at the repository root does the rest. Two parts of it are
load-bearing and easy to break:

**The API is bundled to a single file.** `apps/server/src/vercelEntry.ts` is
bundled by `bun run build:vercel`, and `api/index.ts` re-exports the bundle.
This is not an optimisation. The source is written for Bun — `.ts` import
specifiers — and tsoa generates its route table with extensionless imports.
Node's ESM resolver accepts neither, so without bundling the function fails at
runtime on whichever import it reaches first. `api/package.json` declares
`"type": "module"` because the workspaces are ESM but the repository root is
not, and the nearest `package.json` is what Node consults.

**The rewrites name the API's own resources rather than a prefix.** The API and
the interface both own paths under `/recruitment`: the API serves
`/recruitment/cycles`, the interface serves `/recruitment/<cycleId>/queue`. A
catch-all sends every deep link into the interface to the API, which answers
404 — and the application then works only if nobody ever navigates directly to a
page. If you add a controller with a new top-level route, add it to the
rewrites.

## Environment

Set these on the Vercel project, for Production:

| Variable                | Value                                                   |
| ----------------------- | ------------------------------------------------------- |
| `DATABASE_URL`          | the Neon **pooled** connection string                   |
| `SERVER_URL`            | the deployment's own URL                                |
| `BETTER_AUTH_URL`       | the same URL — the interface and API share an origin    |
| `VITE_SERVER_URL`       | the same URL again; read at build time by the interface |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`, generated fresh              |
| `ALLOWED_ORIGINS_REGEX` | `^https://<domain>$`                                    |
| `ADMIN_GROUP`           | the group name that grants the global admin role        |
| `AUTH_ISSUER`           | `https://idp.scottylabs.org/realms/labrador`            |
| `AUTH_JWKS_URI`         | the realm's JWKS endpoint                               |
| `AUTH_CLIENT_ID`        | `not-yet-registered` until an OIDC client exists        |
| `AUTH_CLIENT_SECRET`    | `not-yet-registered` until an OIDC client exists        |
| `SENTRY_DSN`            | optional                                                |

`AUTH_ISSUER` and `AUTH_JWKS_URI` must be valid URLs even when no client is
registered, because the environment is validated at boot. `AUTH_CLIENT_ID` set
to `not-yet-registered` is what `GET /auth/config` reports on, so the interface
withholds the single sign-on button and explains why instead of sending someone
to an identity provider that will reject them.

## Accounts

Sign-in is by Andrew ID and password. Registration is closed: the Andrew ID is
the primary key every membership, assignment and review points at, so it is
granted by an administrator rather than asserted by whoever fills in a form.

The first account has to come from outside the application, because the admin
endpoint needs an administrator to call it:

```bash
vercel env pull .env.production --environment=production
set -a && . .env.production && set +a
bun run apps/server/scripts/createAccount.ts <andrewId> "Full Name" --admin
```

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

The repository is private and owned by an organisation, which Vercel's Hobby
plan will not connect to Git. Deploys are therefore manual:

```bash
vercel deploy --prod
```

CI still runs on every push; it just does not deploy.
