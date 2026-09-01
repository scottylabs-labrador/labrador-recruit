import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/authClient";

export function SignOutButton({ onSuccess }: { onSuccess?: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        signOut();
        onSuccess?.();
      }}
      className="mt-3 w-full border-white/30 bg-white text-gray-800 hover:bg-gray-100"
    >
      Sign Out
    </Button>
  );
}
