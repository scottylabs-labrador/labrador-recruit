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

export { $api };
