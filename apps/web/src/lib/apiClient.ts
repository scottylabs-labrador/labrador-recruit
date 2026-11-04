import type { paths } from "@recruit/server/build/swagger";
import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";

import { env } from "@/env.ts";

/**
 * The `/v1` prefix lives here rather than in the generated spec.
 *
 * tsoa's `spec.basePath` prefixes only the OpenAPI document, so the generated
 * `paths` are unprefixed and the server mounts its router at `/v1`. Adding the
 * prefix to the base URL is what makes the two agree.
 */
const fetchClient = createFetchClient<paths>({
  baseUrl: `${env.VITE_SERVER_URL}/v1`,
  credentials: "include",
});

const $api = createClient(fetchClient);

/**
 * The raw client, for calls that need the status code.
 *
 * `openapi-react-query` throws the parsed error *body*, which loses the
 * status, and a draft save has to tell a 409 from a 500: one means another tab
 * is ahead and reloading is the fix, the other means retrying might work.
 * Reporting either as the other sends somebody looking for a fault that is not
 * there, or tells them to retry something that will never succeed.
 */
export { fetchClient as apiFetch };
export { $api };
