/**
 * Serverless entry point.
 *
 * Vercel has no long-running process, so the Express application is exported as
 * a request handler instead of being told to listen. `apps/server/src/server.ts`
 * keeps the listening path for every other environment and both share the same
 * `app`, so there is no second wiring of routes or middleware to drift.
 *
 * The import is the *bundled* server rather than its source: the source uses
 * Bun-style `.ts` specifiers and tsoa emits extensionless imports, neither of
 * which Node's ESM resolver accepts.
 *
 * Serving the interface and the API from one deployment also makes them
 * same-origin, which removes the SameSite=None session cookie and the CORS
 * allowlist that a split deployment needs.
 */
export { default } from "../apps/server/dist/vercel.js";
