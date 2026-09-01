import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import { setCycles, setSession } from "./msw/handlers.ts";
import { cycle } from "./recruitmentFixtures.ts";
import { renderApp } from "./render.tsx";

describe("recruitment layout", () => {
  it("explains that a recruitment membership is required when the user has no cycles", async () => {
    setSession(userSession());
    setCycles([]);

    await renderApp("/recruitment");

    expect(await screen.findByText("You are not part of a recruitment cycle yet")).toBeDefined();
    expect(screen.getByText(/recruitment membership/i)).toBeDefined();
  });

  it("offers a cycle picker and the section navigation once a cycle is selected", async () => {
    setSession(userSession());
    setCycles([cycle()]);

    await renderApp("/recruitment/cycle-1");

    const picker = await screen.findByLabelText("Recruitment cycle");
    expect((picker as HTMLSelectElement).value).toBe("cycle-1");
    expect(screen.getByRole("link", { name: "My Queue" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Ranking" })).toBeDefined();
  });
});
