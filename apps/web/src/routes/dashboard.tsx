import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DashboardUsersTableSkeleton } from "@/components/dashboard/DashboardUsersTableSkeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { $api } from "@/lib/apiClient";
import { useSession } from "@/lib/authClient";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: auth, isPending: sessionPending } = useSession();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErrorDetail,
  } = $api.useQuery("get", "/admin/users", {
    params: { query: { page, limit: PAGE_SIZE } },
  });

  if (sessionPending) {
    return <DashboardUsersTableSkeleton />;
  }

  if (!auth?.user) {
    void navigate({ to: "/" });
    return null;
  }

  const isAdmin = auth.user.role === "admin";
  if (!isAdmin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
        <Link to="/" className="text-sm text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  if (usersLoading) {
    return <DashboardUsersTableSkeleton />;
  }

  if (usersError) {
    return (
      <div className="p-6 text-sm text-destructive">
        Error loading users: {usersErrorDetail ? String(usersErrorDetail) : "Unknown error"}
      </div>
    );
  }

  const list = users ?? [];
  const hasNextPage = list.length === PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <div className="flex flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">Admin Dashboard</h1>
      <p className="mb-6 text-sm text-muted-foreground">All users.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>User name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            list.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-sm">{row.id}</TableCell>
                <TableCell>{row.name}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevPage}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNextPage}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
