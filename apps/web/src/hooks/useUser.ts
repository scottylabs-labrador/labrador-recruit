import type { User } from "@labrador/access-control";

import { useSession } from "@/lib/authClient";

export function useUser(): User {
  const { data: auth } = useSession();
  return auth?.user ?? { id: "", role: "guest" };
}
