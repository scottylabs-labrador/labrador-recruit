import { createFileRoute } from "@tanstack/react-router";

/** TODO(#23): Application. Stub so the typed router resolves while the page is built. */
export const Route = createFileRoute("/app/submissions/$applicationId")({
  component: SubmissionDetailPage,
});

function SubmissionDetailPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-xl font-semibold">Application</h1>
    </div>
  );
}
