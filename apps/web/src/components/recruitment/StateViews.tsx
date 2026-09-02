import { AlertTriangle, Inbox } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { cn } from "@/lib/utils";

/** Shared loading, empty, and error presentation, so every screen behaves alike. */

interface EmptyStateProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <Inbox className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-base font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  error?: unknown;
  className?: string;
}

export function ErrorState({ title, error, className }: ErrorStateProps) {
  const detail = error === undefined || error === null ? null : describeError(error);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/5 px-5 py-4",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        {title}
      </p>
      {detail === null ? null : <p className="text-sm leading-6 text-muted-foreground">{detail}</p>}
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "Please try again, or reload the page.";
}

interface TableSkeletonProps {
  columns: string[];
  rows?: number;
}

export function TableSkeleton({ columns, rows = 6 }: TableSkeletonProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <TableRow key={rowIndex}>
            {columns.map((column) => (
              <TableCell key={column}>
                <Skeleton className="h-4 w-24" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}
