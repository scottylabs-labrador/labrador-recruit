import { authHeader, seedUser } from "./harness.ts";

export const alice = {
  id: "alice",
  name: "Alice",
  email: "alice@cmu.edu",
  accountId: "alice-sub",
};

export const bob = {
  id: "bob",
  name: "Bob",
  email: "bob@cmu.edu",
  accountId: "bob-sub",
};

export const adminUser = {
  id: "admin",
  name: "Admin",
  email: "admin@cmu.edu",
  accountId: "admin-sub",
};

export async function seedAlice() {
  await seedUser(alice);
}

export async function seedBob() {
  await seedUser(bob);
}

export async function seedAdmin() {
  await seedUser(adminUser);
}

export const aliceAuth = () => authHeader({ sub: alice.accountId });
export const bobAuth = () => authHeader({ sub: bob.accountId });
export const adminAuth = () => authHeader({ sub: adminUser.accountId, groups: ["test-admins"] });
