import { http, HttpResponse } from "msw";

import { API_URL } from "../fixtures.ts";

export let session: ReturnType<typeof import("../fixtures.ts").userSession> | null = null;
export let adminUsers: Array<{
  id: string;
  name: string;
}> = [];

export function setSession(next: typeof session) {
  session = next;
}

export function setAdminUsers(next: typeof adminUsers) {
  adminUsers = next;
}

export const handlers = [
  http.get(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.get(`${API_URL}/admin/users`, () => {
    return HttpResponse.json(adminUsers);
  }),
];
