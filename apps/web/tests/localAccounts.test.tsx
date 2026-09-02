import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  lastPasswordChange,
  lastSignIn,
  setRejectCredentials,
  setSession,
} from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

/**
 * Accounts are created by an administrator and signed into with an Andrew ID
 * and password. There is deliberately no way to register: the Andrew ID is the
 * key every membership, assignment and review points at, so it is granted
 * rather than self-asserted.
 */
describe("password sign-in", () => {
  it("asks for an Andrew ID and password, and never offers to create an account", async () => {
    await renderApp("/");

    expect(await screen.findByLabelText("Andrew ID")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.queryByText(/create an account/i)).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
  });

  it("completes a bare Andrew ID to the andrew.cmu.edu address", async () => {
    const user = userEvent.setup();
    await renderApp("/");

    await user.type(await screen.findByLabelText("Andrew ID"), "jdoe");
    await user.type(screen.getByLabelText("Password"), "a-real-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(lastSignIn?.email).toBe("jdoe@andrew.cmu.edu");
    });
    expect(lastSignIn?.password).toBe("a-real-password");
  });

  it("accepts a full address without doubling the domain", async () => {
    const user = userEvent.setup();
    await renderApp("/");

    await user.type(await screen.findByLabelText("Andrew ID"), "jdoe@andrew.cmu.edu");
    await user.type(screen.getByLabelText("Password"), "a-real-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(lastSignIn?.email).toBe("jdoe@andrew.cmu.edu");
    });
  });

  it("shows the reason when the credentials are rejected, rather than failing silently", async () => {
    setRejectCredentials(true);
    const user = userEvent.setup();
    await renderApp("/");

    await user.type(await screen.findByLabelText("Andrew ID"), "jdoe");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});

/**
 * A temporary password was issued by an administrator, who therefore knows it,
 * and it very likely travelled through a chat message. Nothing else in the app
 * renders until it has been replaced.
 */
describe("temporary password gate", () => {
  it("blocks the application until the password is replaced", async () => {
    setSession(userSession("admin", true));
    await renderApp("/recruitment");

    expect(await screen.findByRole("heading", { name: "Choose your own password" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Recruitment" })).toBeNull();
  });

  it("says why, naming what the cycle holds", async () => {
    setSession(userSession("user", true));
    await renderApp("/recruitment");

    expect(await screen.findByText(/administrator issued/)).toBeDefined();
  });

  it("lets the application through once a password has been chosen", async () => {
    setSession(userSession("admin", false));
    await renderApp("/recruitment");

    expect(screen.queryByRole("heading", { name: "Choose your own password" })).toBeNull();
  });

  it("refuses a new password that does not match its confirmation", async () => {
    setSession(userSession("user", true));
    const user = userEvent.setup();
    await renderApp("/recruitment");

    await user.type(await screen.findByLabelText("Temporary password"), "temporary-one");
    await user.type(screen.getByLabelText("New password"), "a-good-long-password");
    await user.type(screen.getByLabelText("New password again"), "a-different-password");
    await user.click(screen.getByRole("button", { name: "Set my password" }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("refuses a new password that is too short to be worth setting", async () => {
    setSession(userSession("user", true));
    const user = userEvent.setup();
    await renderApp("/recruitment");

    await user.type(await screen.findByLabelText("Temporary password"), "temporary-one");
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("New password again"), "short");
    await user.click(screen.getByRole("button", { name: "Set my password" }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("refuses to keep the temporary password as the new one", async () => {
    setSession(userSession("user", true));
    const user = userEvent.setup();
    await renderApp("/recruitment");

    const same = "temporary-password";
    await user.type(await screen.findByLabelText("Temporary password"), same);
    await user.type(screen.getByLabelText("New password"), same);
    await user.type(screen.getByLabelText("New password again"), same);
    await user.click(screen.getByRole("button", { name: "Set my password" }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("submits the change when the new password is acceptable", async () => {
    setSession(userSession("user", true));
    const user = userEvent.setup();
    await renderApp("/recruitment");

    await user.type(await screen.findByLabelText("Temporary password"), "temporary-one");
    await user.type(screen.getByLabelText("New password"), "a-good-long-password");
    await user.type(screen.getByLabelText("New password again"), "a-good-long-password");
    await user.click(screen.getByRole("button", { name: "Set my password" }));

    // Asserting on what reached the server, rather than on the page reload the
    // component triggers afterwards: stubbing `location` leaked into other
    // files when a test failed before it could be unstubbed.
    await waitFor(() => {
      expect(lastPasswordChange?.newPassword).toBe("a-good-long-password");
    });
    expect(lastPasswordChange?.currentPassword).toBe("temporary-one");
  });
});
