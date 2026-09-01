import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import {
  resetRecordedRequests,
  setAdminUsers,
  setAggregates,
  setApplications,
  setCommittees,
  setCycles,
  setDisagreements,
  setPeerReviews,
  setProgress,
  setQueue,
  setRanking,
  setReview,
  setRubric,
  setSession,
  setStanding,
  setWorkloads,
} from "./msw/handlers.ts";
import { server } from "./msw/server.ts";

// Route components are code-split, so the first navigation in a file pays for a
// dynamic import and a Vite transform before anything paints.
configure({ asyncUtilTimeout: 5000 });

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
  setCycles([]);
  setCommittees([]);
  setQueue([]);
  setApplications([]);
  setRubric(null);
  setReview(null);
  setAggregates([]);
  setRanking([]);
  setDisagreements([]);
  setPeerReviews([]);
  setWorkloads([]);
  setStanding(null);
  setProgress(null);
  resetRecordedRequests();
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
