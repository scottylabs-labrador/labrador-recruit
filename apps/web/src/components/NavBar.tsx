import { Link } from "@tanstack/react-router";

import { UserProfile } from "@/components/user/UserProfile.tsx";

export function NavBar() {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-gray-800 text-white shadow-lg">
      <div className="flex items-center gap-6">
        <Link to="/" className="text-xl font-semibold">
          LabradorRecruit
        </Link>
        <Link
          to="/recruitment"
          className="rounded-md px-2 py-1 text-sm font-medium text-gray-200 hover:bg-white/10 hover:text-white"
          activeProps={{ className: "bg-white/10 text-white", "aria-current": "page" }}
        >
          Recruitment
        </Link>
      </div>
      <UserProfile />
    </nav>
  );
}
