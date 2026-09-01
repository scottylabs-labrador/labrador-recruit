import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import { setAdminUsers, setSession } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

describe("dashboard", () => {
  it("redirects guests home", async () => {
    await renderApp("/dashboard");

    expect(await screen.findByText("Home")).toBeDefined();
  });

  it("shows the user table for an admin", async () => {
    setSession(userSession("admin"));
    setAdminUsers([{ id: "alice", name: "Alice" }]);
    await renderApp("/dashboard");

    expect(await screen.findByRole("heading", { name: "Admin Dashboard" })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeDefined();
    });
  });
});
