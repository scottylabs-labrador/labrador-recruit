import { Button } from "@/components/ui/button";
import { useIdentityProvider } from "@/hooks/useIdentityProvider";
import { signIn } from "@/lib/authClient";

export function SignInButton() {
  const { configured } = useIdentityProvider();

  // Without a registered OIDC client the redirect lands on Keycloak's own
  // error page, off-site. Saying so here keeps the explanation next to the
  // control that would otherwise fail.
  if (!configured) {
    return (
      <span
        className="text-sm text-white/80"
        title="No OIDC client is registered for this deployment"
      >
        Sign-in unavailable
      </span>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => signIn()}
      className="border-white/30 bg-white text-gray-800 hover:bg-gray-100"
    >
      Sign In
    </Button>
  );
}
