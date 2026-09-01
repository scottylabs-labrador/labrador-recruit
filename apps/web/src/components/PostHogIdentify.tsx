import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useSession } from "@/lib/authClient";

export function PostHogIdentify() {
  const posthog = usePostHog();
  const { data: auth } = useSession();
  const user = auth?.user;

  useEffect(() => {
    if (user) {
      posthog?.identify(user.id);
    } else {
      posthog?.reset();
    }
  }, [posthog, user]);

  return null;
}
