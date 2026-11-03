# 4. Deploy on Railway, store applicant files in Cloudflare R2

Date: 2026-11-03

## Status

Accepted

## Context

The previous version runs on Railway, in the `Labrador Recruiting` project, with
its infrastructure described in code in `.railway/railway.ts`. Before that it ran
on Vercel and Neon; those files are still in the tree and dead.

ScottyLabs Recruit adds two things neither the previous version nor ScottyStack
has:

- **Applicant file uploads.** Proposal section 14.4 requires private
  S3-compatible object storage, size and MIME restrictions, malware scanning,
  ownership verification, and short-lived presigned download URLs.
- **A background worker.** Proposal section 9 requires that email be sent by a
  separate worker or background job, so a temporary delivery failure cannot fail
  an application submission.

ScottyLabs also operates its own self-hosted platform,
[Sheltie](https://github.com/scottylabs-labrador/sheltie), which was considered.

## Decision

**Railway**, in a new project separate from the live `Labrador Recruiting` one,
with four resources: `web` (Caddy serving the Vite build), `server`, `worker`,
and Postgres with a mounted volume.

**Cloudflare R2** for applicant uploads: a private bucket, presigned PUT for
upload and presigned GET for download, with object keys and metadata in the
`file` table.

Migrations stay in `apps/server/docker-entrypoint.sh` with `set -e`, not in
Railway's `preDeployCommand`.

We rejected Sheltie for now. It keeps everything in-house and avoids Railway seat
limits, which are real advantages, but it is unproven for an application of this
shape and nobody on this project has run the worker or object storage story
there. Revisit once the platform is stable; the Dockerfiles are
platform-agnostic, so the move would be an infrastructure change rather than an
application one.

We rejected storing uploads on a Railway volume. Fewer moving parts and no second
vendor, but it couples file durability to one container, breaks the moment the API
scales past one replica, and makes short-lived presigned download URLs something
we implement ourselves rather than something the storage layer gives us.

## Consequences

Good:

- `.railway/railway.ts`, the Dockerfiles, the Caddyfile, and the
  migration-in-entrypoint pattern all transfer from the previous version. The
  infrastructure workstream starts from something that already deploys.
- Railway gives a real long-running process, which the outbox worker and anything
  scheduled need. Vercel did not — the previous version's `setInterval` timers
  silently never ran there.
- R2 is S3-compatible, so the storage client is standard and testable against any
  S3 mock; it has no egress fees; and `scottylabs.org` is already behind
  Cloudflare, so it is not a new vendor relationship.
- Bytes go browser-to-R2 and never traverse the API, so a large upload does not
  occupy a server process.

Bad, and some of it is inherited pain:

- **A second vendor and a second set of credentials** to provision through
  OpenBao and Railway.
- **A new Railway project, not the existing one.** The live v1 deployment keeps
  serving the current cycle, so this costs separate hostnames while building.
  `recruit.scottylabs.org` and `api.recruit.scottylabs.org` both already resolve
  to the old deployment; `dev.api.recruit.scottylabs.org` is already a registered
  redirect URI on the `labrador-recruit-dev` Keycloak client, so that is what the
  new deployment uses until cutover.
- **The origin layout is a real constraint, not a preference.**
  `up.railway.app` is on the Public Suffix List, so two Railway subdomains are
  different _sites_ and a session cookie between them is third-party, which
  Safari blocks outright — sign-in returns 200 and the application behaves as
  though nobody signed in. The previous version solved this by publishing only
  the web service and reverse-proxying the API's paths through it with Caddy. On
  `scottylabs.org` subdomains the two-service layout works. Whichever is chosen,
  it has to be chosen deliberately.
- **Malware scanning is not in the MVP.** The commit path validates size,
  declared MIME type, and magic bytes, behind a `scanFile` hook. A ClamAV sidecar
  is a recorded follow-up in `docs/workstreams.md`. We do not describe the MVP as
  scanning uploads for malware, because it does not.
- Railway's scheduled-job settings were not reachable from its CLI on the account
  the previous version used, which is why migrations live in the entrypoint.
  Expect the same for anything cron-shaped; the worker owns schedules instead.
