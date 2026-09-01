import type { BrowserContext } from "@playwright/test";

import { BETTER_AUTH_SECRET } from "./config.ts";

async function signCookieValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${value}.${b64}`;
}

export async function signIn(context: BrowserContext, sessionToken: string) {
  const value = await signCookieValue(sessionToken, BETTER_AUTH_SECRET);
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
