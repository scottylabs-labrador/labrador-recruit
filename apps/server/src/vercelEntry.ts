/**
 * Bundle entry point for serverless deployment.
 *
 * The application is bundled to a single file rather than shipped as a tree of
 * modules. The source is written for Bun - `.ts` import specifiers, and tsoa
 * generates its route table with extensionless imports - and Node's ESM
 * resolver accepts neither. Bundling resolves every specifier at build time, so
 * nothing is left to resolve at runtime.
 */
export { app as default } from "./app.ts";
