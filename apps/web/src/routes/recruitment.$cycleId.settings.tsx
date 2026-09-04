import { canConfigureCycle } from "@labrador/access-control";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Checkbox, FieldHint, Input, Label, Select } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useIdentityProvider } from "@/hooks/useIdentityProvider";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";

export const Route = createFileRoute("/recruitment/$cycleId/settings")({
  component: SettingsPage,
});

const ROLE_LABELS: Record<string, string> = {
  reviewer: "Reviewer",
  committee_lead: "Committee lead",
  recruitment_admin: "Recruitment admin",
};

const STATUSES = ["draft", "open", "reviewing", "deciding", "archived"] as const;

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

/** Reads a numeric field, treating a blank box as "no value" rather than zero. */
function numberOrNull(form: FormData, name: string): number | null {
  const raw = text(form, name).trim();
  if (raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOr(form: FormData, name: string, fallback: number): number {
  return numberOrNull(form, name) ?? fallback;
}

/**
 * Everything a recruitment admin needs to run a cycle without anyone running a
 * script for them: the cycle's own settings, which committees it runs, who may
 * review, and - until single sign-on is switched on - the accounts they sign in
 * with.
 */
function SettingsPage() {
  const { cycleId } = Route.useParams();
  const { user, isLoaded } = useRecruitmentUser(cycleId);
  const mayConfigure = canConfigureCycle({ user });

  if (isLoaded && !mayConfigure) {
    return (
      <EmptyState
        title="Not yours to change"
        description="Cycle settings are limited to recruitment admins. Ask one of them if something here needs changing."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CycleSettingsSection cycleId={cycleId} enabled={mayConfigure} />
      <CommitteesSection cycleId={cycleId} enabled={mayConfigure} />
      <SheetSection cycleId={cycleId} enabled={mayConfigure} />
      <MembershipsSection cycleId={cycleId} enabled={mayConfigure} />
      <AccountsSection />
    </div>
  );
}

function CycleSettingsSection({ cycleId, enabled }: { cycleId: string; enabled: boolean }) {
  const cycle = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}",
    { params: { path: { cycleId } } },
    { enabled },
  );
  const committees = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees",
    { params: { path: { cycleId } } },
    { enabled },
  );

  const [saved, setSaved] = useState(false);
  const update = $api.useMutation("patch", "/recruitment/cycles/{cycleId}", {
    onSuccess: () => {
      setSaved(true);
      void cycle.refetch();
    },
  });

  if (cycle.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (cycle.isError) {
    return <ErrorState title="Could not load this cycle" error={cycle.error} />;
  }

  const data = cycle.data;
  const committeeList = committees.data ?? [];

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const reviewCommitteeId = text(form, "reviewCommitteeId");

    update.mutate({
      params: { path: { cycleId } },
      body: {
        name: text(form, "name").trim(),
        status: (text(form, "status") || "draft") as (typeof STATUSES)[number],
        minimumReviews: numberOr(form, "minimumReviews", 0),
        candidacyTopN: numberOr(form, "candidacyTopN", 3),
        candidacyIncludeOptIns: form.get("candidacyIncludeOptIns") !== null,
        disagreementSpreadThreshold: numberOr(form, "disagreementSpreadThreshold", 20),
        reviewCommitteeId: reviewCommitteeId === "" ? null : reviewCommitteeId,
        decisionCutoffAdmit: numberOrNull(form, "decisionCutoffAdmit"),
        decisionCutoffReject: numberOrNull(form, "decisionCutoffReject"),
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={data.name} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={data.status}>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
              <FieldHint>Archiving makes the cycle read-only.</FieldHint>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="minimumReviews">Minimum reviews</Label>
              <Input
                id="minimumReviews"
                name="minimumReviews"
                type="number"
                min={0}
                defaultValue={data.minimumReviews}
              />
              <FieldHint>
                How many reviews a candidacy needs before it is ready to decide.
              </FieldHint>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="candidacyTopN">Candidacies from top-N preferences</Label>
              <Input
                id="candidacyTopN"
                name="candidacyTopN"
                type="number"
                min={0}
                defaultValue={data.candidacyTopN}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="disagreementSpreadThreshold">Disagreement spread threshold</Label>
              <Input
                id="disagreementSpreadThreshold"
                name="disagreementSpreadThreshold"
                type="number"
                min={0}
                defaultValue={data.disagreementSpreadThreshold}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reviewCommitteeId">Reviewing as</Label>
              <Select
                id="reviewCommitteeId"
                name="reviewCommitteeId"
                defaultValue={data.reviewCommitteeId ?? ""}
              >
                <option value="">Every committee</option>
                {committeeList.map((committee) => (
                  <option key={committee.id} value={committee.id}>
                    {committee.name}
                  </option>
                ))}
              </Select>
              <FieldHint>
                Scopes every screen to one committee. No candidacy or preference is touched either
                way, so this is reversible.
              </FieldHint>
            </div>
          </div>

          <label className="flex items-start gap-2.5">
            <Checkbox
              name="candidacyIncludeOptIns"
              defaultChecked={data.candidacyIncludeOptIns}
              className="mt-0.5"
            />
            <span className="text-sm leading-6">
              Create a candidacy when an applicant answers a committee&rsquo;s questions, as well as
              for the committees they ranked in their top {data.candidacyTopN}.
            </span>
          </label>

          <fieldset className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Decision lines</legend>
            <FieldHint>
              Drawn across the ranking so a reader can see where leadership intends to cut. Nothing
              is ever decided from these numbers &mdash; somebody still selects the rows and
              confirms.
            </FieldHint>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="decisionCutoffAdmit">Admit above rank</Label>
                <Input
                  id="decisionCutoffAdmit"
                  name="decisionCutoffAdmit"
                  type="number"
                  min={1}
                  placeholder="No line"
                  defaultValue={data.decisionCutoffAdmit ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="decisionCutoffReject">Reject below rank</Label>
                <Input
                  id="decisionCutoffReject"
                  name="decisionCutoffReject"
                  type="number"
                  min={1}
                  placeholder="No line"
                  defaultValue={data.decisionCutoffReject ?? ""}
                />
              </div>
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save settings"}
            </Button>
            {saved && !update.isPending ? (
              <span className="text-sm text-muted-foreground">Saved.</span>
            ) : null}
          </div>
          {update.isError ? <ErrorState title="Could not save" error={update.error} /> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function CommitteesSection({ cycleId, enabled }: { cycleId: string; enabled: boolean }) {
  const committees = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees",
    { params: { path: { cycleId } } },
    { enabled },
  );

  const attach = $api.useMutation("post", "/recruitment/cycles/{cycleId}/committees", {
    onSuccess: () => void committees.refetch(),
  });

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    attach.mutate(
      {
        params: { path: { cycleId } },
        body: {
          slug: text(form, "slug").trim(),
          name: text(form, "name").trim(),
          capacity: numberOrNull(form, "capacity"),
        },
      },
      { onSuccess: () => element.reset() },
    );
  }

  const list = committees.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Committees</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {committees.isError ? (
          <ErrorState title="Could not load committees" error={committees.error} />
        ) : list.length === 0 ? (
          <EmptyState
            title="No committees yet"
            description="A cycle needs at least one committee before anything can be imported or reviewed."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((committee) => (
                <TableRow key={committee.id}>
                  <TableCell>{committee.name}</TableCell>
                  <TableCell className="font-mono text-xs">{committee.slug}</TableCell>
                  <TableCell>{committee.capacity ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="committee-slug">Slug</Label>
            <Input id="committee-slug" name="slug" required placeholder="tech" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="committee-name">Name</Label>
            <Input id="committee-name" name="name" required placeholder="Technology" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="committee-capacity">Capacity</Label>
            <Input id="committee-capacity" name="capacity" type="number" min={0} placeholder="—" />
          </div>
          <Button type="submit" variant="outline" disabled={attach.isPending}>
            {attach.isPending ? "Adding…" : "Add committee"}
          </Button>
        </form>
        <FieldHint>
          Adding a slug that already exists updates its capacity rather than creating a second
          committee.
        </FieldHint>
        {attach.isError ? <ErrorState title="Could not add" error={attach.error} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Where a cycle's applications are pulled from.
 *
 * Syncing stages a preview and stops. A scheduled pull that committed itself
 * would rewrite applicant records with nobody watching, so the import screen's
 * existing preview-then-commit step stays in the way on purpose.
 */
function SheetSection({ cycleId, enabled }: { cycleId: string; enabled: boolean }) {
  const cycle = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}",
    { params: { path: { cycleId } } },
    { enabled },
  );

  const [saved, setSaved] = useState(false);
  const save = $api.useMutation("patch", "/recruitment/cycles/{cycleId}", {
    onSuccess: () => {
      setSaved(true);
      void cycle.refetch();
    },
  });
  const sync = $api.useMutation("post", "/recruitment/cycles/{cycleId}/sync");

  if (cycle.isPending || cycle.isError) {
    return null;
  }

  const sheetId = cycle.data.sourceSheetId;

  function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const range = text(form, "sourceSheetRange").trim();
    save.mutate({
      params: { path: { cycleId } },
      body: {
        sourceSheetId: text(form, "sourceSheetId").trim() || null,
        sourceSheetRange: range === "" ? null : range,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application source</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={connect}>
          <div className="flex min-w-80 flex-1 flex-col gap-1.5">
            <Label htmlFor="sheet-id">Google Sheet</Label>
            <Input
              id="sheet-id"
              name="sourceSheetId"
              defaultValue={sheetId ?? ""}
              placeholder="Paste the sheet link"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-range">Range</Label>
            <Input
              id="sheet-range"
              name="sourceSheetRange"
              defaultValue={cycle.data.sourceSheetRange ?? ""}
              placeholder="First worksheet"
            />
          </div>
          <Button type="submit" variant="outline" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save source"}
          </Button>
          {saved && !save.isPending ? (
            <span className="text-sm text-muted-foreground">Saved.</span>
          ) : null}
        </form>

        <FieldHint>
          Paste the link from your browser; the spreadsheet id is taken out of it. The sheet has to
          be shared with this deployment&rsquo;s Google service account as a viewer, or the sync
          will say it cannot read it. Leave the range blank to read the first worksheet whole, which
          is what a form&rsquo;s response sheet wants.
        </FieldHint>

        {sheetId === null || sheetId === "" ? null : (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={sync.isPending}
                onClick={() => {
                  sync.mutate({ params: { path: { cycleId } } });
                }}
              >
                {sync.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <span className="text-sm text-muted-foreground">
                Reads the sheet and stages an import. Nothing changes until you commit it on the
                Import screen.
              </span>
            </div>
            {sync.isSuccess ? (
              <p className="text-sm leading-6">
                {`Staged ${String(sync.data.preview.rowCount)} rows, `}
                {`${String(sync.data.preview.okCount)} ready and `}
                {`${String(sync.data.preview.errorCount)} with errors. `}
                Open the Import screen to review and commit it.
              </p>
            ) : null}
            {sync.isError ? <ErrorState title="Could not sync" error={sync.error} /> : null}
          </div>
        )}
        {save.isError ? <ErrorState title="Could not save" error={save.error} /> : null}
      </CardContent>
    </Card>
  );
}

function MembershipsSection({ cycleId, enabled }: { cycleId: string; enabled: boolean }) {
  const memberships = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/memberships",
    { params: { path: { cycleId } } },
    { enabled },
  );
  const committees = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/committees",
    { params: { path: { cycleId } } },
    { enabled },
  );

  const grant = $api.useMutation("post", "/recruitment/cycles/{cycleId}/memberships", {
    onSuccess: () => void memberships.refetch(),
  });
  const revoke = $api.useMutation("delete", "/recruitment/memberships/{membershipId}", {
    onSuccess: () => void memberships.refetch(),
  });

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const committeeId = text(form, "committeeId");

    grant.mutate(
      {
        params: { path: { cycleId } },
        body: {
          userId: text(form, "userId").trim().toLowerCase(),
          role: (text(form, "role") || "reviewer") as
            | "reviewer"
            | "committee_lead"
            | "recruitment_admin",
          committeeId: committeeId === "" ? null : committeeId,
        },
      },
      { onSuccess: () => element.reset() },
    );
  }

  const list = memberships.data ?? [];
  const committeeList = committees.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who may review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {memberships.isError ? (
          <ErrorState title="Could not load memberships" error={memberships.error} />
        ) : list.length === 0 ? (
          <EmptyState
            title="Nobody is enrolled yet"
            description="Grant a membership below. Reviewers see only the cycles they are enrolled in."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Andrew ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Committee</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((membership) => (
                <TableRow key={membership.id}>
                  <TableCell className="font-mono text-xs">{membership.userId}</TableCell>
                  <TableCell>{membership.userName}</TableCell>
                  <TableCell>
                    {ROLE_LABELS[membership.role] ?? membership.role}
                    {membership.active ? null : (
                      <Badge variant="outline" className="ml-2">
                        Revoked
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{membership.committeeName ?? "Cycle-wide"}</TableCell>
                  <TableCell className="text-right">
                    {membership.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({
                            params: { path: { membershipId: membership.id } },
                          })
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="membership-user">Andrew ID</Label>
            <Input id="membership-user" name="userId" required placeholder="jdoe" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="membership-role">Role</Label>
            <Select id="membership-role" name="role" defaultValue="reviewer">
              <option value="reviewer">Reviewer</option>
              <option value="committee_lead">Committee lead</option>
              <option value="recruitment_admin">Recruitment admin</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="membership-committee">Committee</Label>
            <Select id="membership-committee" name="committeeId" defaultValue="">
              <option value="">Cycle-wide</option>
              {committeeList.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={grant.isPending}>
            {grant.isPending ? "Granting…" : "Grant"}
          </Button>
        </form>
        <FieldHint>
          The person must have signed in at least once, because a membership points at an account
          that already exists. Granting the same role twice updates it rather than failing, and
          re-granting a revoked one reactivates it.
        </FieldHint>
        {grant.isError ? <ErrorState title="Could not grant" error={grant.error} /> : null}
        {revoke.isError ? <ErrorState title="Could not revoke" error={revoke.error} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Issuing a password account, for a deployment that has no identity provider.
 *
 * Hidden once single sign-on is configured: people provision themselves on
 * first login then, and a password issued here would be a way around the group
 * gate rather than a convenience.
 */
function AccountsSection() {
  const { passwordSignInEnabled } = useIdentityProvider();
  const [issued, setIssued] = useState<{ andrewId: string; temporaryPassword: string } | null>(
    null,
  );

  const create = $api.useMutation("post", "/admin/users", {
    onSuccess: (data) => {
      setIssued({ andrewId: data.andrewId, temporaryPassword: data.temporaryPassword });
    },
  });

  if (!passwordSignInEnabled) {
    return null;
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setIssued(null);
    create.mutate(
      {
        body: {
          andrewId: text(form, "andrewId").trim().toLowerCase(),
          name: text(form, "name").trim(),
          role: (text(form, "role") || "user") as "user" | "admin",
        },
      },
      { onSuccess: () => element.reset() },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldHint>
          This deployment has no identity provider yet, so accounts are granted here rather than
          created by whoever fills in a form. Once single sign-on is switched on this section
          disappears and people sign in with their own Andrew ID.
        </FieldHint>

        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-andrew">Andrew ID</Label>
            <Input id="account-andrew" name="andrewId" required placeholder="jdoe" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" name="name" required placeholder="Jane Doe" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-role">Global role</Label>
            <Select id="account-role" name="role" defaultValue="user">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </form>

        {issued ? (
          <div className="rounded-[10px] border border-border bg-muted/40 p-4">
            <p className="text-sm leading-6">
              Temporary password for <span className="font-mono">{issued.andrewId}</span>:{" "}
              <span className="font-mono font-semibold">{issued.temporaryPassword}</span>
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Shown once and never stored in readable form. If it is lost, issue a new one rather
              than trying to recover this.
            </p>
          </div>
        ) : null}
        {create.isError ? <ErrorState title="Could not create" error={create.error} /> : null}
      </CardContent>
    </Card>
  );
}
