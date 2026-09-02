import { account, user } from "@labrador/db/schema";
import { and, eq } from "drizzle-orm";

import { auth } from "../lib/auth.ts";
import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";

const EMAIL_DOMAIN = "andrew.cmu.edu";
const ANDREW_ID = /^[a-z][a-z0-9]{1,19}$/u;

export interface CreatedAccount {
  andrewId: string;
  email: string;
  name: string;
  role: string;
  /**
   * Shown exactly once, at creation. It is never stored in readable form and
   * cannot be retrieved later - reissue instead, which is also the only way to
   * be sure who has seen it.
   */
  temporaryPassword: string;
}

/**
 * A password that is awkward to mistype and easy to read aloud.
 *
 * No look-alike characters, because these get copied out of a terminal into a
 * chat message and typed back in by hand, and a password that fails on an
 * ambiguous glyph looks like a broken account rather than a typo.
 */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const accountService = {
  /**
   * Creates a sign-in account for an Andrew ID and issues a temporary password.
   *
   * The Andrew ID is the primary key every membership, assignment and review
   * points at, so it is granted here rather than self-asserted at sign-up -
   * which is why registration is closed on the auth instance.
   */
  createAccount: async (input: {
    andrewId: string;
    name: string;
    role?: "user" | "admin";
  }): Promise<CreatedAccount> => {
    const andrewId = input.andrewId.trim().toLowerCase();
    const name = input.name.trim();

    if (!ANDREW_ID.test(andrewId)) {
      throw new HttpError(422, "That does not look like an Andrew ID");
    }
    if (name === "") {
      throw new HttpError(422, "A name is required, so reviewers are attributable");
    }

    const [existing] = await db.select().from(user).where(eq(user.id, andrewId));
    if (existing) {
      throw new HttpError(409, `${andrewId} already has an account`);
    }

    const email = `${andrewId}@${EMAIL_DOMAIN}`;
    const temporaryPassword = generatePassword();
    const now = new Date();

    // The rows are written directly rather than through `signUpEmail`, because
    // sign-up is disabled on the auth instance and that check does not
    // distinguish a stranger posting the form from an administrator granting an
    // account. Better Auth's own hasher is used so the credential verifies
    // exactly as one it created itself.
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(temporaryPassword);

    const [created] = await db
      .insert(user)
      .values({
        id: andrewId,
        name,
        email,
        emailVerified: true,
        role: input.role ?? "user",
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new HttpError(500, "Account was created but could not be read back");
    }

    await db.insert(account).values({
      id: `${andrewId}-credential`,
      accountId: andrewId,
      providerId: "credential",
      userId: andrewId,
      password: hash,
      createdAt: now,
      updatedAt: now,
    });

    return {
      andrewId: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      temporaryPassword,
    };
  },

  /** Issues a fresh temporary password, for someone who has lost theirs. */
  resetPassword: async (andrewId: string): Promise<CreatedAccount> => {
    const id = andrewId.trim().toLowerCase();
    const [existing] = await db.select().from(user).where(eq(user.id, id));
    if (!existing) {
      throw new HttpError(404, "No such account");
    }

    const temporaryPassword = generatePassword();
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(temporaryPassword);

    const updated = await db
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, id), eq(account.providerId, "credential")))
      .returning();

    if (updated.length === 0) {
      throw new HttpError(
        409,
        "That account signs in through an identity provider, not a password",
      );
    }

    await db
      .update(user)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(user.id, id));

    return {
      andrewId: existing.id,
      email: existing.email,
      name: existing.name,
      role: existing.role,
      temporaryPassword,
    };
  },

  /** Clears the flag once somebody has chosen their own password. */
  markPasswordChosen: async (andrewId: string): Promise<void> => {
    await db
      .update(user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(user.id, andrewId));
  },
};
