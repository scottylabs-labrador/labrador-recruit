import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { NavBar } from "@/components/NavBar.tsx";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { MyToastContainer } from "@/components/ToastContainer";

// https://tanstack.com/router/v1/docs/framework/react/guide/router-context#how-about-an-external-data-fetching-library
interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: () => (
    <div className="flex min-h-screen flex-col">
      <PostHogIdentify />
      <NavBar />
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">
        <Outlet />
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
  ),
});
