import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { $api } from "@/lib/apiClient";
import { formatTimestamp } from "@/lib/formatDate.ts";

export const Route = createFileRoute("/app/submissions/")({
  component: SubmissionsPage,
});

/**
 * Every application, and what has happened to it.
 *
 * Shows the **projected** status and nothing else. No score, no shortlist
 * position, no reviewer identity, no internal note, ever — and nothing that
 * distinguishes "being read" from "decided but not released", because this is
 * the page somebody refreshes while waiting and any hint here would be an
 * oracle for a decision that has not been communicated.
 */
function SubmissionsPage() {
  const applications = $api.useQuery("get", "/me/applications", {});

  if (applications.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const list = applications.data ?? [];

  if (list.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-6 py-16">
        <h1 className="text-xl font-semibold">You have not applied to anything yet</h1>
        <p className="mt-3 max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          Once you start an application it will appear here, with its status and the time you sent
          it.
        </p>
        <Link
          to="/app/committees"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Browse committees
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-10">
      <h1 className="text-xl font-semibold">Your applications</h1>
      <p className="mt-2 max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
        ScottyLabs will email you when there is something to tell you. Nothing on this page changes
        until then.
      </p>

      <div className="mt-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Committee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((row) => (
              <TableRow key={row.applicationId}>
                <TableCell className="font-medium">{row.committeeName}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "Withdrawn" ? "danger" : "default"}>
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.submittedAt === null ? "Not submitted" : formatTimestamp(row.submittedAt)}
                </TableCell>
                <TableCell>
                  <Link
                    to="/app/submissions/$applicationId"
                    params={{ applicationId: row.applicationId }}
                    className="text-sm font-medium underline"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
