import { useNavigate } from "@tanstack/react-router";

import { ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { FieldHint, Input, Label } from "@/components/ui/field.tsx";
import { $api } from "@/lib/apiClient";

/**
 * Reads a text field.
 *
 * `FormData.get` can hand back a `File`, which would stringify to
 * "[object File]" and be sent as if the person had typed it. Narrowing to a
 * string means a file dropped on a text input reads as empty instead.
 */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Starts a cycle.
 *
 * Lands on the new cycle's settings rather than its overview, because a cycle
 * with no committee and nobody enrolled has nothing to show yet - the next
 * thing to do is always attach a committee.
 */
export function NewCycleForm() {
  const navigate = useNavigate();

  const create = $api.useMutation("post", "/recruitment/cycles", {
    onSuccess: (created) => {
      void navigate({
        to: "/recruitment/$cycleId/settings",
        params: { cycleId: created.id },
      });
    },
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      body: {
        slug: text(form, "slug").trim().toLowerCase(),
        name: text(form, "name").trim(),
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a cycle</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-cycle-slug">Slug</Label>
            <Input id="new-cycle-slug" name="slug" required placeholder="fall-2027" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-cycle-name">Name</Label>
            <Input id="new-cycle-name" name="name" required placeholder="Fall 2027" />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create cycle"}
          </Button>
        </form>
        <FieldHint className="mt-3">
          The slug is what the imported spreadsheet and any scripts refer to, so it is worth keeping
          short and predictable.
        </FieldHint>
        {create.isError ? (
          <ErrorState title="Could not create the cycle" error={create.error} />
        ) : null}
      </CardContent>
    </Card>
  );
}
