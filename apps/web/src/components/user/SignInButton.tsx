import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/authClient";

export function SignInButton() {
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
