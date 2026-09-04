import type { User } from "@labrador/access-control";
import { account, user } from "@labrador/db/schema";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Request as ExpressRequest } from "express";

import { AuthenticationError } from "../middlewares/errorHandler.ts";
import { auth } from "./auth.ts";
import { verifyBearer, verifyOidc } from "./authentication.ts";
import { db } from "./db.ts";
import { getRoleFromJwt, toRole } from "./role.ts";

/**
 * Get user from the request for access control.
 */
export async function getAcUserFromRequest(req: ExpressRequest): Promise<User> {
  const jwtPayload = (await verifyBearer(req)) ?? (await verifyOidc(req));

  const sub = jwtPayload?.sub;

  // An identity provider was used: the subject identifies the account, and the
  // token's groups decide the global role.
  if (typeof sub === "string") {
    const rows = await db
      .select({ user })
      .from(user)
      .innerJoin(account, eq(user.id, account.userId))
      .where(eq(account.accountId, sub));

    let dbUser = rows[0]?.user;

    // When no provider token is readable, `verifyOidc` synthesises the subject
    // from the user id rather than the provider account id. Look the person up
    // that way before giving up, or an expired provider token turns every
    // request from a valid session into a failure.
    if (!dbUser) {
      const [byId] = await db.select().from(user).where(eq(user.id, sub));
      dbUser = byId;
    }

    if (!dbUser) {
      // A verified subject that matches nobody is an authentication problem to
      // report as one, not an internal error to page someone about.
      throw new AuthenticationError();
    }

    return { id: dbUser.id, role: getRoleFromJwt(jwtPayload) };
  }

  // Otherwise this is a local password account, which carries no token. The
  // session still identifies the person; the role comes from their user row.
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  const sessionUserId = session?.user.id;
  if (typeof sessionUserId !== "string") {
    return { id: "", role: "guest" };
  }

  const [dbUser] = await db.select().from(user).where(eq(user.id, sessionUserId));
  if (!dbUser) {
    return { id: "", role: "guest" };
  }

  return { id: dbUser.id, role: toRole(dbUser.role) };
}

export { getRoleFromJwt } from "./role.ts";
