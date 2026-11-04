import { Link } from "@tanstack/react-router";

import { UserProfile } from "@/components/user/UserProfile.tsx";

/**
 * The application shell's navigation.
 *
 * Deliberately bare. The student and staff surfaces arrive with #23 and #24,
 * and the links into them belong to a role switcher driven by `GET /v1/me`
 * rather than to a hardcoded list here — somebody with no grants should never
 * see a staff link at all. See `docs/ui.md` section 4.
 */
export function NavBar() {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-gray-800 text-white shadow-lg">
      <Link to="/" className="text-xl font-semibold">
        ScottyLabs Recruit
      </Link>
      <UserProfile />
    </nav>
  );
}
