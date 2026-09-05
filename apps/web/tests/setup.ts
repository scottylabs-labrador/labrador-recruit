import { cleanup, configure } from "@testing-library/react";
import { cleanStores } from "nanostores";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { authClient } from "@/lib/authClient.ts";

import {
  resetRecordedRequests,
  setAdminUsers,
  setAggregates,
  setApplications,
  setCommitReport,
  setCommittees,
  setCycles,
  setDecisionExport,
  setDisagreements,
  setDistributionPlan,
  setImportPreview,
  setImportRows,
  setImports,
  setPeerReviews,
  setProgress,
  setQueue,
  setRanking,
  setRankingExport,
  setReview,
  setReviewerLoadExport,
  setRubric,
  setRubricValidation,
  setRubricVersions,
  resetAuthProbes,
  resetDecisions,
  setIdentityProviderConfigured,
  setSession,
  setSignInFails,
  setStanding,
  setWorkloads,
} from "./msw/handlers.ts";
import { server } from "./msw/server.ts";

// Route components are code-split, so the first navigation in a file pays for a
// dynamic import and a Vite transform before anything paints. Five seconds was
// enough on a warm cache but not on a cold one under load: editing a module
// these routes import invalidates the transform cache, and the first test in a
// file then renders nothing within the window. This is a ceiling rather than a
// delay, so raising it costs nothing when the tests pass.
//
// Raised again to 45s. The review page is the heaviest render in the suite and
// takes about 15 seconds on its own; `turbo run test` puts the server suite on
// the same machine at the same time, and under that the review test reliably
// crossed 30s. This is headroom for a slow render, not a fix for it - the
// render being that slow is worth looking at on its own terms.
configure({ asyncUtilTimeout: 45_000 });

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
  setSignInFails(false);
  setIdentityProviderConfigured(true);
  resetAuthProbes();
  resetDecisions();
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
  setDistributionPlan(null);
  setPeerReviews([]);
  setWorkloads([]);
  setStanding(null);
  setProgress(null);
  setImports([]);
  setImportPreview(null);
  setImportRows([]);
  setCommitReport(null);
  setRubricVersions([]);
  setRubricValidation(null);
  setRankingExport([]);
  setDecisionExport([]);
  setReviewerLoadExport([]);
  resetRecordedRequests();
});

afterEach(() => {
  server.resetHandlers();
  cleanup();

  // Better Auth keeps its session in a nanostores atom, and nanostores defers a
  // store's teardown by a second after its last subscriber goes away
  // (`STORE_UNMOUNT_DELAY`). Unmounting React therefore only *schedules* the
  // teardown: a file that finishes inside that second leaves a timer behind,
  // which fires after the DOM environment is gone and dies on `window` in Better
  // Auth's `removeEventListener` cleanup. That surfaced as an unhandled
  // `ReferenceError: window is not defined` failing the run about one time in
  // six, blamed on whichever file happened to finish last.
  //
  // `cleanStores` runs the same teardown synchronously, while the window still
  // exists, and empties the queue so the deferred timer has nothing left to do.
  cleanStores(authClient.$store.atoms.session);
});

afterAll(() => {
  server.close();
});
