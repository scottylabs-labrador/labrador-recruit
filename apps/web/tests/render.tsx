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

  const queryClient = getQueryClient();
  queryClient.setDefaultOptions({
    queries: { retry: false },
    mutations: { retry: false },
  });

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
