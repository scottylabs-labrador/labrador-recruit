import { user } from "@labrador/db/schema";
import { desc } from "drizzle-orm";

import { db } from "../lib/db.ts";

export const userService = {
  /**
   * List users (admin only). Paginated.
   */
  listUsers: async (options?: { page?: number; limit?: number }) => {
    const page = Math.max(0, options?.page ?? 0);
    const limit = Math.min(100, Math.max(1, options?.limit ?? 10));

    return db
      .select({ id: user.id, name: user.name })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(page * limit);
  },
};
