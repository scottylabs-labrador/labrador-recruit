import { createFileRoute } from "@tanstack/react-router";

/** TODO(#23): Your applications. Stub so the typed router resolves while the page is built. */
export const Route = createFileRoute("/app/submissions/")({
  component: SubmissionsPage,
});

function SubmissionsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-xl font-semibold">Your applications</h1>
    </div>
  );
}
