import { $api } from "@/lib/apiClient";

/**
 * Whether signing in can actually work on this deployment.
 *
 * Sign-in leaves the application for Keycloak, and Better Auth builds that
 * redirect from the issuer's discovery document without checking that the
 * client exists. On a deployment whose OIDC client has not been registered
 * yet, the button therefore works perfectly right up until the user lands on
 * Keycloak's own "Client not found" error, off-site, with nothing to say what
 * went wrong or who can fix it.
 *
 * While the answer is still loading, sign-in is treated as available: the
 * common case by far is a configured deployment, and briefly disabling the
 * button on every page load would be worse than the rare wrong guess.
 */
export function useIdentityProvider(): { configured: boolean; isPending: boolean } {
  const { data, isPending } = $api.useQuery("get", "/auth/config", {});

  return {
    configured: data?.identityProviderConfigured ?? true,
    isPending,
  };
}
