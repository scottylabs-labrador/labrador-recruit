import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

import "./styles.css";
import { StrictMode } from "react";
import ReactDom from "react-dom/client";

import { env } from "@/env.ts";

import { getQueryClient } from "./lib/queryClient.ts";
import { reportWebVitals } from "./reportWebVitals.ts";
import { routeTree } from "./routeTree.gen.ts";

// Create a new router instance
const queryClient = getQueryClient();
const TanStackQueryProviderContext = { queryClient };
const router = createRouter({
  routeTree,
  context: {
    ...TanStackQueryProviderContext,
  },
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Initialize Posthog https://posthog.com/docs/libraries/react
//
// The key is optional, and local development ships without one. Initialising
// with an empty key made posthog-js log a misconfiguration error on every page
// load, which trains people to ignore the console in the one app where a
// console error is worth reading. With no key we skip both the init and the
// provider; `usePostHog()` then returns undefined, which every caller already
// handles because analytics has always been optional here.
const posthogKey = env.VITE_PUBLIC_POSTHOG_KEY;
const analyticsEnabled = posthogKey !== undefined && posthogKey !== "";

if (analyticsEnabled) {
  posthog.init(posthogKey, {
    api_host: env.VITE_PUBLIC_POSTHOG_HOST,
  });
}

function withAnalytics(children: React.ReactNode) {
  if (!analyticsEnabled) return children;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

// Render the app
const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDom.createRoot(rootElement);
  root.render(
    <StrictMode>
      {withAnalytics(
        <QueryClientProvider client={TanStackQueryProviderContext.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )}
    </StrictMode>,
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
