import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input, Label, Select } from "@/components/ui/field.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { $api } from "@/lib/apiClient";
import { applicantLabel, type ApplicationListItem, yearLabel } from "@/lib/recruitment.ts";

const COLUMNS = ["Applicant", "Year", "Major", "Committee preferences"];
const PAGE_LIMIT = 500;

export const Route = createFileRoute("/recruitment/$cycleId/applicants")({
  component: ApplicantsPage,
});

function ApplicantsPage() {
  const { cycleId } = Route.useParams();
  const [search, setSearch] = useState("");
  const [committeeFilter, setCommitteeFilter] = useState("");

  const committees = $api.useQuery("get", "/recruitment/cycles/{cycleId}/committees", {
    params: { path: { cycleId } },
  });

  const query: { limit: number; committeeId?: string } = { limit: PAGE_LIMIT };
  if (committeeFilter !== "") query.committeeId = committeeFilter;

  const applications = $api.useQuery("get", "/recruitment/cycles/{cycleId}/applications", {
    params: { path: { cycleId }, query },
  });

  const committeeList = committees.data ?? [];
  const all = applications.data ?? [];
  const filtered = all.filter((item) => matchesSearch(item, search));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Applicants</h2>
          <p className="text-sm text-muted-foreground">
            Everyone you are permitted to see in this cycle. Submitted answers are shown verbatim.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="applicant-search" className="flex items-center gap-1.5">
              <Search className="size-3.5" aria-hidden />
              Search
            </Label>
            <Input
              id="applicant-search"
              type="search"
              className="w-56"
              placeholder="Name, major, or year"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="applicant-committee-filter">Committee</Label>
            <Select
              id="applicant-committee-filter"
              className="w-48"
              value={committeeFilter}
              onChange={(event) => setCommitteeFilter(event.target.value)}
            >
              <option value="">All committees</option>
              {committeeList.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {applications.isLoading
          ? "Loading applicants…"
          : `${filtered.length} of ${all.length} applicant${all.length === 1 ? "" : "s"} shown`}
      </p>

      {applications.isError ? (
        <ErrorState title="Could not load applicants" error={applications.error} />
      ) : applications.isLoading ? (
        <TableSkeleton columns={COLUMNS} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No applicants in this cycle" : "No applicants match"}
          description={
            all.length === 0
              ? "Applications appear here once a recruitment admin imports them."
              : "Try a different search term or clear the committee filter."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.applicationId}>
                <TableCell className="font-medium">
                  <Link
                    to="/recruitment/$cycleId/applicant/$applicationId"
                    params={{ cycleId, applicationId: item.applicationId }}
                    className="rounded-md text-primary-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {applicantLabel(item.applicantName)}
                  </Link>
                </TableCell>
                <TableCell>{yearLabel(item.year)}</TableCell>
                <TableCell className="max-w-64 truncate">{item.major ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <ul className="flex flex-wrap gap-1.5">
                    {[...item.committees]
                      .sort((a, b) => a.rank - b.rank)
                      .map((committee) => (
                        <li key={committee.committeeId}>
                          <Badge variant={committee.hasCandidacy ? "default" : "muted"}>
                            {committee.rank}. {committee.name}
                            {committee.hasCandidacy ? " · candidacy" : ""}
                          </Badge>
                        </li>
                      ))}
                    {item.committees.length === 0 ? (
                      <li className="text-sm text-muted-foreground">No ranking submitted</li>
                    ) : null}
                  </ul>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Plain substring matching over fields the caller can already see. */
function matchesSearch(item: ApplicationListItem, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (term === "") return true;
  const haystack = [item.applicantName, item.major, item.year, item.email]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}
