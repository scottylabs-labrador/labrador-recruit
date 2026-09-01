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
posthog.init(env.VITE_PUBLIC_POSTHOG_KEY || "", {
  api_host: env.VITE_PUBLIC_POSTHOG_HOST,
});

// Render the app
const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDom.createRoot(rootElement);
  root.render(
    <StrictMode>
      <PostHogProvider client={posthog}>
        <QueryClientProvider client={TanStackQueryProviderContext.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </PostHogProvider>
    </StrictMode>,
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
