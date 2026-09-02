import { createFileRoute, Navigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useIdentityProvider } from "@/hooks/useIdentityProvider";
import { signIn, useSession } from "@/lib/authClient";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

/**
 * Signed in, `/` is a redirect rather than a screen. Everything anyone does
 * here happens inside a cycle, and `/recruitment` already renders the three
 * cases that follow from standing: the cycles you can open, the "ask an admin
 * to enrol you" state, and the picker. Duplicating any of that here would mean
 * two places to keep in step with the membership rules.
 */
function IndexComponent() {
  const { data: auth, isPending } = useSession();
  const identityProvider = useIdentityProvider();

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-24 w-full max-w-[62ch]" />
      </div>
    );
  }

  if (auth?.user) {
    return <Navigate to="/recruitment" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-16">
      <div className="max-w-[62ch]">
        <h1 className="text-2xl leading-tight font-semibold">Labrador Recruit</h1>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          The recruitment review platform for ScottyLabs leadership. Leadership imports the
          committee application form, reviewers score applicants against a published rubric, and the
          platform reports aggregates, reviewer disagreement, and committee rankings.
        </p>
        <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
          Applicants are not evaluated by any model. Every subjective score comes from a named human
          reviewer, and every figure the platform reports is arithmetic over those scores.
        </p>

        {identityProvider.configured ? (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button onClick={() => signIn()}>Sign in with your Andrew ID</Button>
            <span className="text-sm text-muted-foreground">
              You will reach the cycles you are enrolled in.
            </span>
          </div>
        ) : (
          <div className="mt-8 rounded-[10px] border border-border bg-muted/40 p-4">
            <h2 className="text-sm font-semibold">Sign-in is not available yet</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This deployment has no OIDC client registered with the ScottyLabs identity provider,
              so Andrew ID sign-in cannot complete. Sending you to Keycloak would only produce a
              &ldquo;Client not found&rdquo; error there, so the button is withheld rather than
              offered.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A ScottyLabs administrator needs to register a client for this deployment and set its
              id and secret on the API. Until then, access is granted directly by whoever runs this
              instance.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
