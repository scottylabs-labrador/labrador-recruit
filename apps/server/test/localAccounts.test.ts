import { user } from "@labrador/db/schema";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { accountService } from "../src/services/accountService.ts";
import { testDb } from "./harness.ts";

/**
 * Local password accounts, for running a cycle before an identity provider
 * exists. The Andrew ID is the primary key every membership, assignment and
 * review points at, so it is granted by an administrator rather than asserted
 * by whoever fills in a form.
 */
describe("local accounts", () => {
  it("creates an account whose id is the Andrew ID, not a generated one", async () => {
    const created = await accountService.createAccount({ andrewId: "jdoe", name: "J Doe" });

    expect(created.andrewId).toBe("jdoe");
    expect(created.email).toBe("jdoe@andrew.cmu.edu");

    const [row] = await testDb.select().from(user).where(eq(user.id, "jdoe"));
    expect(row?.id).toBe("jdoe");
    expect(row?.name).toBe("J Doe");
  });

  it("issues a temporary password and marks the account as needing a new one", async () => {
    const created = await accountService.createAccount({ andrewId: "kwong", name: "K Wong" });

    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(12);

    const [row] = await testDb.select().from(user).where(eq(user.id, "kwong"));
    expect(row?.mustChangePassword).toBe(true);
  });

  it("lets that password actually sign in", async () => {
    const created = await accountService.createAccount({ andrewId: "lpatel", name: "L Patel" });

    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: created.email, password: created.temporaryPassword });

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("refuses the wrong password", async () => {
    const created = await accountService.createAccount({ andrewId: "mchen", name: "M Chen" });

    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: created.email, password: `${created.temporaryPassword}x` });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  /**
   * Registration is closed deliberately. Open sign-up would put a stranger one
   * form submission away from an account on a system holding applicant essays,
   * and would let the Andrew ID be self-asserted.
   */
  it("does not let anyone register themselves", async () => {
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email: "intruder@andrew.cmu.edu", password: "correct-horse-battery", name: "X" });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const [row] = await testDb.select().from(user).where(eq(user.id, "intruder"));
    expect(row).toBeUndefined();
  });

  it("records the global role on the user, since there is no token to read", async () => {
    await accountService.createAccount({ andrewId: "nadmin", name: "N Admin", role: "admin" });

    const [row] = await testDb.select().from(user).where(eq(user.id, "nadmin"));
    expect(row?.role).toBe("admin");
  });

  it("refuses a second account for the same Andrew ID", async () => {
    await accountService.createAccount({ andrewId: "odup", name: "O Dup" });

    await expect(accountService.createAccount({ andrewId: "odup", name: "O Dup" })).rejects.toThrow(
      /already has an account/,
    );
  });

  it("rejects something that is not an Andrew ID rather than creating a stray row", async () => {
    await expect(
      accountService.createAccount({ andrewId: "not an id!", name: "P Q" }),
    ).rejects.toThrow(/Andrew ID/);
  });

  it("requires a name, so a review always has an attributable author", async () => {
    await expect(accountService.createAccount({ andrewId: "rname", name: "  " })).rejects.toThrow(
      /name is required/,
    );
  });

  it("reissues a password without creating a second account", async () => {
    const first = await accountService.createAccount({ andrewId: "sreset", name: "S Reset" });
    await accountService.markPasswordChosen("sreset");

    const reissued = await accountService.resetPassword("sreset");
    expect(reissued.temporaryPassword).not.toBe(first.temporaryPassword);

    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: reissued.email, password: reissued.temporaryPassword });
    expect(signIn.status).toBe(200);

    const [row] = await testDb.select().from(user).where(eq(user.id, "sreset"));
    expect(row?.mustChangePassword).toBe(true);
  });

  it("invalidates the old password when a new one is issued", async () => {
    const first = await accountService.createAccount({ andrewId: "told", name: "T Old" });
    await accountService.resetPassword("told");

    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: first.email, password: first.temporaryPassword });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
