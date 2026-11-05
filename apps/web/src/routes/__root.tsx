import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { NavBar } from "@/components/NavBar.tsx";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { MyToastContainer } from "@/components/ToastContainer";
import { ChangePasswordGate } from "@/components/user/ChangePasswordGate";
import { useSession } from "@/lib/authClient";

// https://tanstack.com/router/v1/docs/framework/react/guide/router-context#how-about-an-external-data-fetching-library
interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

/**
 * A wrong URL, explained.
 *
 * Without this the router renders its own `<p>Not Found</p>`, with no heading,
 * no way back, and nothing to say whether the platform is broken or the link
 * was. An applicant following a stale link from an old announcement is the
 * likeliest person to land here, and they need the committees, not a
 * diagnosis.
 */
function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[62ch] px-6 py-20">
      <h1 className="text-xl font-semibold">That page does not exist</h1>
      <p className="mt-3 text-[0.95rem] leading-7 text-muted-foreground">
        The link may be out of date, or the page may have moved. Nothing is wrong with your
        application.
      </p>
      <Link to="/recruit" className="mt-6 inline-block text-sm font-medium underline">
        Go to the committees
      </Link>
    </div>
  );
}

/**
 * Nothing renders until a temporary password has been replaced.
 *
 * The gate lives here rather than on each route because it has to hold for
 * every one of them: an administrator issued that password and knows it, and
 * this cycle holds real applicants' essays and contact details.
 */
function RootComponent() {
  const { data: auth } = useSession();
  const mustChangePassword = auth?.user.mustChangePassword === true;

  return (
    <div className="flex min-h-screen flex-col">
      <PostHogIdentify />
      <NavBar />
      {/*
        The document scrolls, not this element.
        `overflow-auto` here made `main` the nearest scrolling ancestor, which
        is what `position: sticky` measures against - so the review page's
        rubric panel, which asks to stick 1rem below the top of the viewport,
        was pinning itself to a box that never moved. It simply sat there while
        the application text scrolled past it.
      */}
      <main className="flex flex-1 flex-col">
        {mustChangePassword ? <ChangePasswordGate /> : <Outlet />}
      </main>
      <MyToastContainer />
      <TanStackDevtools
        config={{
          position: "bottom-right",
        }}
        plugins={[
          {
            name: "Tanstack Router",
            render: <TanStackRouterDevtoolsPanel />,
          },
          {
            name: "Tanstack Query",
            render: <ReactQueryDevtoolsPanel />,
          },
        ]}
      />
    </div>
  );
}
