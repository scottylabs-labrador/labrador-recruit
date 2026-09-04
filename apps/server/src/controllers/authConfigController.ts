import { Controller, Get, Route, SuccessResponse } from "tsoa";

import { env } from "../env.ts";
import { isClientIdRegistered, isPasswordSignInEnabled } from "../lib/authConfig.ts";

export interface AuthConfigResponse {
  /**
   * False when no OIDC client has been registered for this deployment, which
   * means sign-in cannot succeed and the interface should say so rather than
   * redirect to an identity provider that will reject the request.
   */
  identityProviderConfigured: boolean;
  /**
   * Whether an Andrew ID and password can be used to sign in.
   *
   * False once an identity provider is configured: password accounts are the
   * fallback for a deployment without one, not a second door alongside it. The
   * interface reads this so it stops offering a form that the API would refuse.
   */
  passwordSignInEnabled: boolean;
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
    const configured = isClientIdRegistered(env.AUTH_CLIENT_ID);
    return {
      identityProviderConfigured: configured,
      passwordSignInEnabled: isPasswordSignInEnabled(env.PASSWORD_SIGN_IN, configured),
    };
  }
}
