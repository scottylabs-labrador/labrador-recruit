import { Controller, Get, Route, SuccessResponse } from "tsoa";

import { env } from "../env.ts";
import { isClientIdRegistered } from "../lib/authConfig.ts";

export interface AuthConfigResponse {
  /**
   * False when no OIDC client has been registered for this deployment, which
   * means sign-in cannot succeed and the interface should say so rather than
   * redirect to an identity provider that will reject the request.
   */
  identityProviderConfigured: boolean;
}

/**
 * Deliberately unauthenticated: its whole purpose is to tell a signed-out
 * visitor whether signing in is possible. It reports a boolean and nothing
 * else - no client id, no issuer, no secret.
 */
@Route("auth")
export class AuthConfigController extends Controller {
  @Get("config")
  @SuccessResponse(200)
  getAuthConfig(): AuthConfigResponse {
    return { identityProviderConfigured: isClientIdRegistered(env.AUTH_CLIENT_ID) };
  }
}
