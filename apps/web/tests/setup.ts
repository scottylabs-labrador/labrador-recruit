import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { setIdentityProviderConfigured, setSession } from "./msw/handlers.ts";
import { server } from "./msw/server.ts";

// Route components are code-split, so the first navigation in a file pays for a
// dynamic import and a Vite transform before anything paints. This is a ceiling
// rather than a delay, so raising it costs nothing when the tests pass.
configure({ asyncUtilTimeout: 20_000 });

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
  // An endpoint a test forgets to mock fails loudly instead of hanging.
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  setSession(null);
  setIdentityProviderConfigured(true);
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
