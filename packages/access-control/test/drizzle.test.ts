import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";
import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { drizzleWhere } from "../src/drizzle.ts";
import type { User } from "../src/types.ts";

type DocumentSubject = { userId: string; private: boolean };
type DocumentAction = "read" | "update" | "delete";
type DocumentAbility = MongoAbility<[DocumentAction, DocumentSubject | "Document"]>;

const document = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  private: boolean().notNull().default(false),
});

const guest: User = { id: "", role: "guest" };
const alice: User = { id: "alice", role: "user" };
const admin: User = { id: "admin", role: "admin" };

function getDocumentAbility(user: User): DocumentAbility {
  const { build, can: allow } = new AbilityBuilder<DocumentAbility>(createMongoAbility);

  allow("read", "Document", { private: false });

  if (user.role === "user" || user.role === "admin") {
    allow("read", "Document", { userId: user.id });
    allow("update", "Document", { userId: user.id });
  }

  if (user.role === "admin") {
    allow("read", "Document");
    allow("delete", "Document");
  }

  return build();
}

describe("drizzleWhere", () => {
  it("returns no restriction for an admin reading documents", () => {
    expect(drizzleWhere(getDocumentAbility(admin), "read", "Document", document)).toBeUndefined();
  });

  it("returns a filter for a guest or user reading documents", () => {
    expect(drizzleWhere(getDocumentAbility(guest), "read", "Document", document)).toBeDefined();
    expect(drizzleWhere(getDocumentAbility(alice), "read", "Document", document)).toBeDefined();
  });

  it("throws when the action is forbidden", () => {
    expect(() => drizzleWhere(getDocumentAbility(guest), "delete", "Document", document)).toThrow();
  });
});
