import { useState } from "react";

import { Button } from "@/components/ui/button";
import { changePassword } from "@/lib/authClient";

const MINIMUM = 12;

/**
 * Blocks everything until a temporary password has been replaced.
 *
 * An administrator issued that password and therefore knows it, and it very
 * likely travelled through a chat message to get here. Letting an account sit
 * on it indefinitely would mean applicant essays are readable by whoever can
 * still scroll back far enough.
 */
export function ChangePasswordGate() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MINIMUM) {
      setError(`Your new password needs at least ${MINIMUM} characters.`);
      return;
    }
    if (newPassword !== confirmation) {
      setError("The two new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from the temporary one.");
      return;
    }

    setBusy(true);
    const message = await changePassword(currentPassword, newPassword);
    setBusy(false);
    if (message !== null) {
      setError(message);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-16">
      <div className="max-w-[62ch]">
        <h1 className="text-2xl leading-tight font-semibold">Choose your own password</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          You signed in with a temporary password that an administrator issued, so somebody other
          than you has seen it. Pick your own before going any further. This cycle holds real
          applicants&rsquo; names, essays and contact details.
        </p>

        <form onSubmit={submit} className="mt-8 max-w-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="currentPassword" className="text-sm font-medium">
                Temporary password
              </label>
              <input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="newPassword" className="text-sm font-medium">
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">At least {MINIMUM} characters.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmation" className="text-sm font-medium">
                New password again
              </label>
              <input
                id="confirmation"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm"
              />
            </div>

            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set my password"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
