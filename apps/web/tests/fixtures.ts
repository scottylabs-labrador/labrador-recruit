export const API_URL = "http://localhost:3001";

export function userSession(role: "user" | "admin" = "user", mustChangePassword = false) {
  return {
    user: {
      id: "alice",
      name: "Alice",
      email: "alice@cmu.edu",
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      role,
      mustChangePassword,
    },
    session: {
      id: "sess-1",
      expiresAt: "2027-01-01T00:00:00.000Z",
      token: "tok",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      userId: "alice",
    },
  };
}
