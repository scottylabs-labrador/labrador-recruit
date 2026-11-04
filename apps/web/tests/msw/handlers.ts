import { http, HttpResponse } from "msw";

/**
 * The mocked API surface.
 *
 * Deliberately small. The handlers grow with the endpoints they stand in for,
 * and `onUnhandledRequest: "error"` means an endpoint a test forgets to mock
 * fails loudly here rather than hanging — so an empty-looking file is the
 * honest starting point rather than a gap.
 */
const API = "http://localhost:3001";

export type Session = {
  user: { id: string; name: string; email: string; role: "admin" | "user" | "guest" };
} | null;

export let session: Session = null;

export function setSession(next: Session) {
  session = next;
}

let identityProviderConfigured = true;

export function setIdentityProviderConfigured(next: boolean) {
  identityProviderConfigured = next;
}

export const handlers = [
  http.get(`${API}/api/auth/get-session`, () => HttpResponse.json(session)),

  http.get(`${API}/v1/auth/config`, () =>
    HttpResponse.json({
      identityProviderConfigured,
      passwordSignInEnabled: !identityProviderConfigured,
    }),
  ),

  http.get(`${API}/v1/health`, () => HttpResponse.json({ status: "ok" })),
];
