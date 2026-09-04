import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";

import { EmptyState, ErrorState, TableSkeleton } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
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
import {
  applicantLabel,
  type ApplicationListItem,
  type CandidacyFilter,
  CANDIDACY_FILTER_OPTIONS,
  isCandidacyFilter,
  YEAR_FILTER_OPTIONS,
  yearLabel,
} from "@/lib/recruitment.ts";

const COLUMNS = ["Applicant", "Year", "Major", "Committee preferences"];
const PAGE_LIMIT = 500;

/**
 * A query-string value, or the empty string for anything that is not one.
 *
 * The URL is user-editable, so a param can arrive as an array (`?q=a&q=b`) or
 * an object. Coercing those with `String()` would put "[object Object]" in a
 * filter box, so anything that is not already a string is treated as absent.
 */
/** Drops defaulted filters so the URL carries only what someone chose. */
function stripEmpty(next: ApplicantSearch): ApplicantSearch {
  const out: ApplicantSearch = {};
  if (next.q) out.q = next.q;
  if (next.committee) out.committee = next.committee;
  if (next.year) out.year = next.year;
  if (next.candidacy && next.candidacy !== "all") out.candidacy = next.candidacy;
  return out;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Every field is optional so that a plain link to this route stays a plain
 * link. An absent param also keeps the URL clean: only filters someone
 * actually set appear in it.
 */
interface ApplicantSearch {
  q?: string;
  committee?: string;
  year?: string;
  candidacy?: CandidacyFilter;
}

/**
 * Filters live in the URL so a view survives a reload and can be pasted to
 * someone else. A cycle's applicant list is the thing people talk about across
 * a table, and "the sophomores with no Design candidacy" is much easier to hand
 * over as a link than as instructions.
 */
export const Route = createFileRoute("/recruitment/$cycleId/applicants")({
  component: ApplicantsPage,
  validateSearch: (raw: Record<string, unknown>): ApplicantSearch => {
    const candidacy = readString(raw["candidacy"]);
    return stripEmpty({
      q: readString(raw["q"]),
      committee: readString(raw["committee"]),
      year: readString(raw["year"]),
      candidacy: isCandidacyFilter(candidacy) ? candidacy : "all",
    });
  },
});

function ApplicantsPage() {
  const { cycleId } = Route.useParams();
  const raw = Route.useSearch();
  const search = raw.q ?? "";
  const committeeFilter = raw.committee ?? "";
  const yearFilter = raw.year ?? "";
  const candidacy: CandidacyFilter = raw.candidacy ?? "all";
  const navigate = Route.useNavigate();

  function setFilters(patch: Partial<ApplicantSearch>) {
    void navigate({
      search: (previous) => stripEmpty({ ...previous, ...patch }),
      replace: true,
    });
  }

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
  const filtered = all.filter(
    (item) =>
      matchesSearch(item, search) &&
      matchesYear(item, yearFilter) &&
      matchesCandidacy(item, candidacy, committeeFilter),
  );
  const anyFilterActive =
    search !== "" || committeeFilter !== "" || yearFilter !== "" || candidacy !== "all";

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
              placeholder="Name, email, major, or year"
              value={search}
              onChange={(event) => setFilters({ q: event.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="applicant-committee-filter">Committee</Label>
            <Select
              id="applicant-committee-filter"
              className="w-48"
              value={committeeFilter}
              onChange={(event) => setFilters({ committee: event.target.value })}
            >
              <option value="">All committees</option>
              {committeeList.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="applicant-year-filter">Year</Label>
            <Select
              id="applicant-year-filter"
              className="w-40"
              value={yearFilter}
              onChange={(event) => setFilters({ year: event.target.value })}
            >
              <option value="">All years</option>
              {YEAR_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="applicant-candidacy-filter">Candidacy</Label>
            <Select
              id="applicant-candidacy-filter"
              className="w-52"
              value={candidacy}
              onChange={(event) => {
                const next = event.target.value;
                if (isCandidacyFilter(next)) setFilters({ candidacy: next });
              }}
            >
              {CANDIDACY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          {anyFilterActive ? (
            <Button
              variant="outline"
              onClick={() => setFilters({ q: "", committee: "", year: "", candidacy: "all" })}
            >
              <X aria-hidden /> Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {candidacy !== "all" && committeeFilter === "" ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Candidacy status is being read across the whole cycle, where almost everyone has a
          candidacy somewhere. Pick a committee to ask the useful version of the question — who
          ranked it but is not being reviewed for it.
        </p>
      ) : null}

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

/**
 * Whether the applicant is in the selected year. An empty filter matches all,
 * so the query string stays absent rather than carrying a sentinel value.
 */
function matchesYear(item: ApplicationListItem, year: string): boolean {
  return year === "" || item.year === year;
}

/**
 * Whether the applicant has a candidacy, optionally narrowed to one committee.
 *
 * With a committee selected the question is about that committee specifically;
 * without one it is "anywhere in the cycle". Both readings are useful and the
 * committee picker is what disambiguates, so no separate control is needed.
 */
function matchesCandidacy(
  item: ApplicationListItem,
  filter: CandidacyFilter,
  committeeId: string,
): boolean {
  if (filter === "all") return true;
  const scope =
    committeeId === ""
      ? item.committees
      : item.committees.filter((committee) => committee.committeeId === committeeId);
  const has = scope.some((committee) => committee.hasCandidacy);
  return filter === "with" ? has : !has;
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
