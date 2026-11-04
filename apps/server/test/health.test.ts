import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";

describe("GET /v1/health", () => {
  it("reports liveness without authentication", async () => {
    const res = await request(app).get("/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("reveals nothing beyond liveness", async () => {
    const res = await request(app).get("/v1/health");

    // A public endpoint returns only what a poster on a wall could say. No
    // version, no counts, no configuration.
    expect(Object.keys(res.body as object)).toEqual(["status"]);
  });
});
