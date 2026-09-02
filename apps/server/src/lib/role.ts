import type { Role } from "@labrador/access-control";
import type jwt from "jsonwebtoken";

import { env } from "../env.ts";

/**
 * The global role carried by an identity provider's access token.
 *
 * Lives in its own module so `auth.ts` can use it without importing
 * `accessControl.ts`, which imports `auth.ts` back. The cycle resolved at
 * runtime but meant the request-scoped identity code could not safely reach for
 * the session, which is exactly what local password accounts need it to do.
 */
export function getRoleFromJwt(jwtPayload: jwt.JwtPayload | null | undefined | string): Role {
  // When the user is not authenticated, return a guest role.
  if (!jwtPayload || typeof jwtPayload !== "object") {
    return "guest";
  }

  // When the user is authenticated but not in any groups, return a user role.
  const groups = jwtPayload["groups"];
  if (!groups) {
    return "user";
  }

  // When the user is in the admin group, return an admin role.
  return groups.includes(env.ADMIN_GROUP) ? "admin" : "user";
}

/** Narrows a stored role string to the union, defaulting to the least access. */
export function toRole(stored: string | null | undefined): Role {
  return stored === "admin" || stored === "user" ? stored : "user";
}
