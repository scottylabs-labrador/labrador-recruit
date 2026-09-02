import { useState } from "react";

import { Button } from "@/components/ui/button";
import { signInWithPassword } from "@/lib/authClient";

/**
 * Andrew ID and password.
 *
 * Accounts are created by an administrator, not here: the Andrew ID is the key
 * every membership, assignment and review points at, so it is granted rather
 * than self-asserted. There is deliberately no "create an account" link.
 */
export function SignInForm() {
  const [andrewId, setAndrewId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const message = await signInWithPassword(andrewId, password);
    setBusy(false);
    if (message !== null) {
      setError(message);
      return;
    }
    // The session drives what renders; a reload is the simplest way to let
    // every query re-run against the newly authenticated identity.
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="andrewId" className="text-sm font-medium">
            Andrew ID
          </label>
          <input
            id="andrewId"
            name="andrewId"
            autoComplete="username"
            required
            value={andrewId}
            onChange={(event) => setAndrewId(event.target.value)}
            className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">Just the id, not the full address.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm"
          />
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Ask a recruitment admin if you need an account.
          </span>
        </div>
      </div>
    </form>
  );
}
