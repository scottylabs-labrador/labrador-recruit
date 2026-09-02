import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { env } from "../src/env.ts";

describe("GET /auth/config", () => {
  it("is readable without signing in, which is the whole point of it", async () => {
    const res = await request(app).get("/auth/config");

    expect(res.status).toBe(200);
    expect(typeof res.body.identityProviderConfigured).toBe("boolean");
  });

  /** It answers a signed-out visitor, so it must not carry anything sensitive. */
  it("discloses only the boolean, never the issuer or the secret", async () => {
    const res = await request(app).get("/auth/config");

    expect(Object.keys(res.body)).toEqual(["identityProviderConfigured"]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(env.AUTH_CLIENT_SECRET);
    expect(body).not.toContain(env.AUTH_ISSUER);
  });
});
