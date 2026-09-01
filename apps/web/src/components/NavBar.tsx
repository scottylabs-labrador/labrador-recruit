import { UserProfile } from "@/components/user/UserProfile.tsx";

export function NavBar() {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-gray-800 text-white shadow-lg">
      <span className="text-xl font-semibold">LabradorRecruit</span>
      <UserProfile />
    </nav>
  );
}
