import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button.tsx";
import { SignInForm } from "@/components/user/SignInForm";
import { useIdentityProvider } from "@/hooks/useIdentityProvider";
import { signIn } from "@/lib/authClient";

/**
 * Where to send the person once they are signed in.
 *
 * Validated to a same-site path. A `redirect` that could be an absolute URL
 * would make this page an open redirector: a link to our own sign-in that
 * lands somebody on an attacker's copy of it, with our domain in the part of
 * the URL they actually read. So anything that is not a plain path starting
 * with a single `/` is discarded in favour of the dashboard.
 */
function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/app/dashboard";
  }
  return value;
}

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search["redirect"]),
  }),
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  const identityProvider = useIdentityProvider();

  return (
    <div className="mx-auto w-full max-w-[640px] px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        ScottyLabs Recruit
      </p>
      <h1 className="mt-2 text-2xl leading-tight font-semibold">Sign in</h1>
      <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
        Use your Andrew ID. Every CMU student has one and there is nothing to sign up for.
      </p>

      {identityProvider.passwordSignInEnabled ? <SignInForm /> : null}

      {identityProvider.configured ? (
        <div className="mt-8">
          <Button onClick={() => signIn(redirect)}>Sign in with your Andrew ID</Button>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            You will be sent to CMU to sign in. You will be returned to{" "}
            <span className="font-medium">{redirect}</span> afterwards.
          </p>
        </div>
      ) : (
        <div className="mt-8 rounded-[10px] border border-border bg-muted/40 p-4">
          <h2 className="text-sm font-semibold">Single sign-on is not available yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This deployment has no OIDC client registered with the ScottyLabs identity provider, so
            single sign-on cannot complete. Sending you to Keycloak would only produce a
            &ldquo;Client not found&rdquo; error there, so that button is withheld rather than
            offered. Use the Andrew ID and password above instead.
          </p>
        </div>
      )}

      <section aria-labelledby="data-use" className="mt-12">
        <h2 id="data-use" className="text-base font-semibold">
          Your data
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          <li>
            Applicants are not evaluated by any model. No score is inferred from anything you write;
            every subjective score comes from a named human reviewer.
          </li>
          <li>
            Your answers are visible to reviewers on the committees you apply to, and to ScottyLabs
            administrators. A committee cannot see an application you did not send it.
          </li>
          <li>
            Your name and Andrew ID come from CMU when you sign in. You can correct the rest on your
            profile.
          </li>
          <li>
            Drafts are saved as you type and are not visible to any committee until you submit.
          </li>
        </ul>
      </section>

      <section aria-labelledby="trouble" className="mt-10">
        <h2 id="trouble" className="text-base font-semibold">
          If sign-in does not work
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          CMU accepts every valid Andrew ID, so if you get back here and are still refused, the
          problem is this platform rather than your account, and a ScottyLabs administrator can fix
          it. Tell them what you were trying to reach.
        </p>
        <a
          href="mailto:hello@scottylabs.org"
          className="mt-3 inline-block text-sm font-medium underline"
        >
          Contact ScottyLabs
        </a>
      </section>

      <p className="mt-10 text-sm">
        <Link to="/recruit" className="underline">
          Back to the committees
        </Link>
      </p>
    </div>
  );
}
