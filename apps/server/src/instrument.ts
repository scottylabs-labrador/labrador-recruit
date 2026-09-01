import * as Sentry from "@sentry/bun";

// Reference: https://docs.sentry.io/platforms/javascript/guides/bun/
const result = Sentry.init({ dsn: process.env["SENTRY_DSN"] });
console.log("Sentry initialized with DSN:", result?.getOptions().dsn);
