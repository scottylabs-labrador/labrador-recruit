import { createFileRoute } from "@tanstack/react-router";

/** TODO(#23): Your profile. Stub so the typed router resolves while the page is built. */
export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-xl font-semibold">Your profile</h1>
    </div>
  );
}
