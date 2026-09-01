import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { adminAuth, alice, aliceAuth, seedAdmin, seedAlice } from "./fixtures.ts";

describe("GET /admin/users", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/admin/users");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
  });

  it("returns 403 for a non-admin user", async () => {
    await seedAlice();

    const res = await request(app).get("/admin/users").set(aliceAuth());

    expect(res.status).toBe(403);
  });

  it("returns 200 with users for an admin", async () => {
    await seedAlice();
    await seedAdmin();

    const res = await request(app).get("/admin/users").set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: alice.id,
          name: alice.name,
        }),
      ]),
    );
    expect(res.body[0]).not.toHaveProperty("postCount");
    expect(res.body[0]).not.toHaveProperty("replyCount");
  });
});
