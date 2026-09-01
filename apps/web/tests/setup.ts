import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { setAdminUsers, setSession } from "./msw/handlers.ts";
import { server } from "./msw/server.ts";

vi.mock("posthog-js/react", () => ({
  PostHogProvider: ({ children }: { children: unknown }) => children,
  usePostHog: () => ({ identify: vi.fn(), reset: vi.fn() }),
}));

vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: () => null,
}));

vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtoolsPanel: () => null,
}));

vi.mock("@tanstack/react-router-devtools", () => ({
  TanStackRouterDevtoolsPanel: () => null,
}));

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  setSession(null);
  setAdminUsers([]);
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
