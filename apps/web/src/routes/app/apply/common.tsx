import { createFileRoute } from "@tanstack/react-router";

/** TODO(#23): Shared questions. Stub so the typed router resolves while the page is built. */
export const Route = createFileRoute("/app/apply/common")({
  component: CommonFormPage,
});

function CommonFormPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-xl font-semibold">Shared questions</h1>
    </div>
  );
}
