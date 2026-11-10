import type { User } from "@recruit/access-control";
import { account, user } from "@recruit/db/schema";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { Request as ExpressRequest } from "express";

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

    const dbUser = rows[0]?.user;
    if (!dbUser) {
      /*
       * A valid token for somebody we have never seen.
       *
       * Not an error: it is what a first sign-in looks like before the auth
       * callback has written the account row, and it is also what a token from
       * another realm looks like. Throwing here made it a 500 — a server fault
       * for a request that was simply not authenticated, and one that reached
       * the generic error branch.
       *
       * A guest with an empty id is the honest answer, and every caller already
       * has to handle it.
       */
      return { id: "", role: "guest" };
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
