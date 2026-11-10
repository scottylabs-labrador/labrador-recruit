import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { authClient } from "@/lib/authClient";
import { getQueryClient } from "@/lib/queryClient";
import { routeTree } from "@/routeTree.gen";

import { session } from "./msw/handlers.ts";

export async function renderApp(path = "/") {
  authClient.$store.notify("$sessionSignal");
  await authClient.getSession({
    query: { disableCookieCache: true },
  });
  authClient.$store.atoms["session"]?.set({
    data: session,
    error: null,
    isPending: false,
    isRefetching: false,
  });

  /*
   * The real client, with its real retry policy.
   *
   * This used to force `retry: false` for every query, and that is exactly how
   * two defects reached the end-to-end suite unseen: the production client
   * retried an expected 404 with backoff, so a page that should explain itself
   * instantly sat on a skeleton, and the global error toast then reported
   * "Something went wrong" over the explanation. A harness that is kinder than
   * production tests a product that does not exist.
   */
  const queryClient = getQueryClient();

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    router,
    queryClient,
  };
}
