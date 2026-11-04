import { createFileRoute } from "@tanstack/react-router";

/** TODO(#23): Review and submit. Stub so the typed router resolves while the page is built. */
export const Route = createFileRoute("/app/review")({
  component: ReviewPage,
});

function ReviewPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-xl font-semibold">Review and submit</h1>
    </div>
  );
}
