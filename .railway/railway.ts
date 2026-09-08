import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

/**
 * The Railway project, in code.
 *
 * Follows ScottyStack's own `.railway/railway.ts` — GitHub source, Dockerfile
 * builds, a Railway Postgres with a volume — with two deliberate departures,
 * both recorded here because a future reader will otherwise "fix" them back.
 *
 * **One public origin, not two.** ScottyStack publishes the interface and the
 * API on sibling hosts (`stack.scottylabs.org`, `api.stack.scottylabs.org`).
 * That works there because both sit under one registrable domain, so a cookie
 * set by the API is same-site for the interface. It does not work here.
 * `up.railway.app` is on the Public Suffix List, which makes
 * `labrador-recruit-production.up.railway.app` and any sibling *different
 * sites* rather than merely different hosts - so the session cookie becomes a
 * third-party cookie, which Safari blocks outright. Sign-in returns 200, the
 * browser discards the cookie, and the application looks signed out with
 * nothing on screen to say why.
 *
 * So the API is never published. It listens on the private network and
 * `apps/web/Caddyfile` reverse-proxies the API's own paths through the
 * interface's origin. One origin means `SameSite=Lax` and no CORS at all.
 * Moving to a real domain (`recruit.scottylabs.org`) would make the
 * two-service layout viable again, but there would still be no reason to
 * prefer it.
 *
 * **Migrations run from the entrypoint, not `preDeployCommand`.**
 * `apps/server/docker-entrypoint.sh` applies them and `set -e` aborts the
 * container if they fail, so Railway keeps the previous deployment serving
 * rather than routing traffic at a half-migrated database. The `railway.json`
 * this file replaces also declared a `preDeployCommand`, which meant the same
 * migration ran twice per deploy and could fail in two different places.
 */
/**
 * Whether to serve on the ScottyLabs domain rather than Railway's.
 *
 * This is the single switch for the whole cutover, because the two layouts are
 * not independently choosable - the domain decides whether single sign-on can
 * work at all.
 *
 * Goldador's `infra/inputs.json` declares this project as
 * `website = recruit.scottylabs.org` and `server = api.recruit.scottylabs.org`,
 * and `infra/keycloak/teams.tf` generates the prod client's one permitted
 * redirect URI from `server`. Keycloak accepts that URI and rejects every
 * other, the Railway hostname included - so on `up.railway.app` the only way in
 * is an Andrew ID and password.
 *
 * Flip this to `true` only once both CNAMEs resolve and Railway reports the
 * domains verified. Doing it earlier points the interface at a hostname that
 * does not exist yet.
 */
const USE_SCOTTYLABS_DOMAIN = true;

/** Where the interface is served. */
const WEB_HOST = USE_SCOTTYLABS_DOMAIN
  ? "recruit.scottylabs.org"
  : "labrador-recruit-production.up.railway.app";

/**
 * Where the API answers.
 *
 * On the ScottyLabs domain this is a second public host, which is ScottyStack's
 * own layout and is what Goldador registered. It is safe there because both
 * names sit under `scottylabs.org`, so the session cookie is same-site.
 *
 * On Railway it is the interface's own host: `up.railway.app` is a public
 * suffix, so two Railway subdomains would be different *sites* and the cookie
 * would be third-party. `apps/web/Caddyfile` proxies the API's paths through
 * the one origin instead.
 */
const API_HOST = USE_SCOTTYLABS_DOMAIN ? "api.recruit.scottylabs.org" : WEB_HOST;

export default defineRailway(() => {
  const LabradorRecruit = github("scottylabs-labrador/labrador-recruit", {
    branch: "main",
  });

  const Postgres = postgres("Postgres");
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  // Pinned to what Railway provisioned. Left unspecified, every subsequent
  // `config plan` proposes nulling the region and size back out, which reads as
  // a destructive change against the database's own storage.
  const postgresVolume = volume("postgres-volume", {
    sizeMB: 50000,
    region: "us-east4-eqdc4a",
  });
  /**
   * Attached explicitly. Declaring the volume as a project resource creates it
   * but mounts it nowhere - ScottyStack's own file stops there - and a Postgres
   * whose data directory is container-local loses every row on the next
   * deploy. The mount path is the one the Railway Postgres image already
   * declares as `defaultMountPath`.
   */
  Postgres.volumeMounts = { "postgres-volume": { mountPath: "/var/lib/postgresql/data" } };

  /**
   * The API. No domain of its own, by design - see the note above.
   *
   * `SERVER_PORT` is pinned rather than taking Railway's `PORT`, because the
   * interface has to name this port in `API_ORIGIN` and a value Railway
   * chooses is not knowable from the other service's configuration.
   */
  const server = service("labrador-recruit-server", {
    source: LabradorRecruit,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/server/Dockerfile",
      watchPatterns: [
        "/apps/server/**",
        "/packages/common/**",
        "/packages/access-control/**",
        "/packages/db/**",
      ],
    },
    networking: {
      privateNetworkEndpoint: "labradorrecruitserver",
      // Registered ahead of the cutover so the certificate is already issued
      // when DNS lands. Unreachable until the CNAME exists, and harmless.
      customDomains: { "api.recruit.scottylabs.org": {} },
    },
    env: {
      ADMIN_GROUP: "labrador-recruit-admins",
      // Derived from WEB_HOST so the allow-list cannot be left pointing at
      // the previous origin when the domain switch is flipped.
      ALLOWED_ORIGINS_REGEX: `^https://${WEB_HOST.replaceAll(".", "\\.")}$`,
      /**
       * The Goldador groups permitted to sign in, which is the team slug.
       * `ADMIN_GROUP` is always allowed on top of this.
       */
      AUTH_ALLOWED_GROUPS: "labrador-recruit",
      /**
       * The registered prod client. Setting this to a real id is the cutover:
       * the interface starts offering CMU single sign-on and stops offering
       * Andrew ID and password in the same change, because `PASSWORD_SIGN_IN`
       * is `auto`.
       *
       * Returning it to `not-yet-registered` is the escape hatch, and restores
       * password sign-in immediately. That is what makes it safe for the group
       * gate to fail closed.
       */
      // Tied to the domain switch, because the two cannot disagree: Goldador
      // registered exactly one redirect URI for this client, derived from
      // `api.recruit.scottylabs.org`. On the Railway hostname Keycloak rejects
      // the callback, so single sign-on there would authenticate people at CMU
      // and then strand them - with password sign-in already disabled, since
      // `PASSWORD_SIGN_IN` is `auto`. Falling back to the sentinel keeps that
      // combination unreachable.
      AUTH_CLIENT_ID: USE_SCOTTYLABS_DOMAIN ? "labrador-recruit-prod" : "not-yet-registered",
      /**
       * Held by Railway, never written here.
       *
       * `env.ts` requires a string, so this must always have a value: the
       * placeholder era is over, but preserving an unset variable would leave
       * it `undefined` and the server would die on its own environment
       * validation after migrating the database.
       */
      AUTH_CLIENT_SECRET: preserve(),
      AUTH_ISSUER: "https://idp.scottylabs.org/realms/labrador",
      AUTH_JWKS_URI: "https://idp.scottylabs.org/realms/labrador/protocol/openid-connect/certs",
      /**
       * Signs the session cookie.
       *
       * Generated by Railway rather than written here or pasted through a
       * terminal: the value never exists outside the platform, so there is
       * nothing to leak and nothing to rotate after setup. Rotating it later
       * invalidates every live session, which is the intended effect.
       */
      /**
       * Preserved, not regenerated.
       *
       * Railway generated the value once via `${{secret(48)}}`; leaving that
       * template here would mint a fresh key on every `config apply` and
       * invalidate every live session as a side effect of an unrelated change.
       * `preserve()` keeps what the platform holds and keeps it out of source.
       * To rotate deliberately, clear the variable in Railway and re-apply
       * with the template.
       */
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: `https://${WEB_HOST}`,
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      /**
       * Off. Fetching an applicant-supplied link at all is a carve-out from
       * `docs/product-rules.md` §1, so a deployment opts in explicitly.
       */
      GITHUB_ENRICHMENT: "off",
      PASSWORD_SIGN_IN: "auto",
      SENTRY_DSN: preserve(),
      SERVER_PORT: "8080",
      /**
       * The public origin, not this service's own address: Better Auth builds
       * its OAuth callback URL from this, and the browser reaches it through
       * the interface's origin.
       */
      SERVER_URL: `https://${API_HOST}`,
    },
  });

  /**
   * The interface, and the only thing with a public address.
   *
   * Named `labrador-recruit` to match the service that already exists in the
   * project: the generated domain is derived from the service name, so
   * renaming it would move the deployment off
   * `labrador-recruit-production.up.railway.app`.
   */
  const web = service("labrador-recruit", {
    source: LabradorRecruit,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/web/Dockerfile",
      watchPatterns: [
        "/apps/web/**",
        "/packages/common/**",
        "/packages/access-control/**",
        "/packages/db/**",
      ],
    },
    networking: {
      serviceDomains: { "labrador-recruit-production.up.railway.app": {} },
      customDomains: { "recruit.scottylabs.org": {} },
      privateNetworkEndpoint: "labradorrecruitweb",
    },
    env: {
      /** Where Caddy sends the API's paths. Private network, so plain HTTP. */
      API_ORIGIN: "http://${{labrador-recruit-server.RAILWAY_PRIVATE_DOMAIN}}:8080",
      VITE_PUBLIC_POSTHOG_HOST: preserve(),
      VITE_PUBLIC_POSTHOG_KEY: preserve(),
      /**
       * Read by Vite at *build* time, so this is baked into the bundle and a
       * change needs a rebuild rather than a restart. It is this service's own
       * origin: the browser talks to one host and Caddy decides what is API.
       */
      VITE_SERVER_URL: `https://${API_HOST}`,
    },
  });

  return project("Labrador Recruiting", {
    resources: [Postgres, postgresVolume, server, web],
  });
});
