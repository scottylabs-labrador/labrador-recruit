import { canConfigureCycle } from "@labrador/access-control";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import {
  CRITERION_SOURCE_OPTIONS,
  type CriterionInput,
  type CriterionSource,
  formatDateTime,
  formatWeightPercent,
  type RubricVersionSummary,
  weightsSumToOne,
} from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/rubric")({
  component: RubricPage,
});

const VALIDATE_DEBOUNCE_MS = 400;

/**
 * A criterion while it is being edited. Every numeric field is held as text, so
 * a half-typed `0.` is a state the editor can represent rather than one it
 * silently rewrites under the cursor.
 */
interface DraftCriterion {
  uid: string;
  key: string;
  label: string;
  description: string;
  weight: string;
  minScore: string;
  maxScore: string;
  source: CriterionSource;
  active: boolean;
}

let uidCounter = 0;

function nextUid(): string {
  uidCounter += 1;
  return `draft-${uidCounter}`;
}

function blankCriterion(): DraftCriterion {
  return {
    uid: nextUid(),
    key: "",
    label: "",
    description: "",
    weight: "",
    minScore: "1",
    maxScore: "5",
    source: "reviewer",
    active: true,
  };
}

function toDraft(criterion: RubricVersionSummary["criteria"][number]): DraftCriterion {
  return {
    uid: nextUid(),
    key: criterion.key,
    label: criterion.label,
    description: criterion.description ?? "",
    weight: String(criterion.weight),
    minScore: String(criterion.minScore),
    maxScore: String(criterion.maxScore),
    source: criterion.source === "application_preference" ? "application_preference" : "reviewer",
    active: criterion.active,
  };
}

function parseNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function toCriteriaInput(draft: readonly DraftCriterion[]): CriterionInput[] {
  return draft.map((row) => ({
    key: row.key.trim(),
    label: row.label.trim(),
    description: row.description.trim() === "" ? null : row.description.trim(),
    weight: parseNumber(row.weight),
    minScore: parseNumber(row.minScore),
    maxScore: parseNumber(row.maxScore),
    source: row.source,
    active: row.active,
  }));
}

/**
 * Everything the editor can decide for itself, before the server is asked.
 *
 * These are not a substitute for the server's own validation — the server's
 * `issues[]` are rendered verbatim alongside them — but they let the weight
 * total tell the truth on the keystroke rather than after a round trip.
 */
function localProblems(draft: readonly DraftCriterion[], total: number): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [index, row] of draft.entries()) {
    const position = index + 1;
    const key = row.key.trim();

    if (key === "") {
      problems.push(`Criterion ${position} has no key. A key identifies the criterion in scores.`);
    } else if (seen.has(key)) {
      problems.push(`More than one criterion uses the key "${key}". Keys must be unique.`);
    } else {
      seen.add(key);
    }

    if (row.label.trim() === "") {
      problems.push(`Criterion ${position} has no label, so a reviewer would see a blank field.`);
    }

    const weight = parseNumber(row.weight);
    if (Number.isNaN(weight)) {
      problems.push(`Criterion ${position} has a weight that is not a number.`);
    } else if (weight < 0) {
      problems.push(
        `Criterion ${position} has a negative weight. Weights must be zero or greater.`,
      );
    }

    const min = parseNumber(row.minScore);
    const max = parseNumber(row.maxScore);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      problems.push(`Criterion ${position} has a minimum or maximum score that is not a number.`);
    } else if (min >= max) {
      problems.push(
        `Criterion ${position} has a minimum of ${min} that is not below its maximum of ${max}.`,
      );
    }
  }

  const activeCount = draft.filter((row) => row.active).length;
  if (activeCount === 0) {
    problems.push("No criterion is active, so no review score could be calculated.");
  } else if (!weightsSumToOne(total)) {
    problems.push(
      `The active weights sum to ${total.toFixed(3)} (${formatWeightPercent(total)}) rather than ` +
        `1 (100%). Adjust them so they add up to exactly 1.`,
    );
  }

  return problems;
}

function RubricPage() {
  const { cycleId } = Route.useParams();
  const { user, isLoaded } = useRecruitmentUser(cycleId);
  const mayConfigure = canConfigureCycle({ user });

  const versions = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/rubrics",
    { params: { path: { cycleId } } },
    { enabled: mayConfigure },
  );

  const [name, setName] = useState("");
  const [draft, setDraft] = useState<DraftCriterion[] | null>(null);
  /** Null while the editor still needs seeding from the active version. */
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const { mutate: validateDraft, data: validation } = $api.useMutation(
    "post",
    "/recruitment/cycles/{cycleId}/rubrics/validate",
  );

  const publish = $api.useMutation("post", "/recruitment/cycles/{cycleId}/rubrics", {
    onSuccess: () => {
      setConfirmingPublish(false);
      setSeededFrom(null);
      void versions.refetch();
    },
  });

  const loaded = versions.data;
  const ordered = [...(loaded ?? [])].sort((left, right) => right.version - left.version);
  const activeVersion = ordered.find((version) => version.active) ?? ordered[0];

  // Editing is copy-and-revise: the editor opens holding whatever is live, so a
  // small change to one weight never means retyping six criteria from memory.
  useEffect(() => {
    if (loaded === undefined || seededFrom !== null) return;
    if (activeVersion === undefined) {
      setDraft([blankCriterion()]);
      setName("Rubric v1");
      setSeededFrom("blank");
      return;
    }
    setDraft(activeVersion.criteria.map(toDraft));
    setName(activeVersion.name);
    setSeededFrom(activeVersion.id);
  }, [loaded, seededFrom, activeVersion]);

  /*
   * The debounced draft is carried into the effect as JSON rather than as an
   * array. Depending on the array itself would re-run the effect on every
   * render — the array is rebuilt each time — and the timer would then be
   * cleared before it ever fired, so the server would never be asked at all.
   */
  const criteriaJson = draft === null ? null : JSON.stringify(toCriteriaInput(draft));

  useEffect(() => {
    if (criteriaJson === null) return;
    const criteria = JSON.parse(criteriaJson) as CriterionInput[];
    const timer = setTimeout(() => {
      validateDraft({ params: { path: { cycleId } }, body: { criteria } });
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [criteriaJson, cycleId, validateDraft]);

  if (isLoaded && !mayConfigure) {
    return (
      <EmptyState title="Editing the rubric is a recruitment-admin action">
        <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          The rubric decides how every review in this cycle is weighted, so only a recruitment admin
          can publish one. Ask one to make the change, or to grant you the recruitment-admin role in
          this cycle.
        </p>
      </EmptyState>
    );
  }

  if (versions.isError) {
    return <ErrorState title="Could not load the rubric versions" error={versions.error} />;
  }

  if (draft === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const activeTotal = draft
    .filter((row) => row.active)
    .reduce((sum, row) => {
      const weight = parseNumber(row.weight);
      return Number.isNaN(weight) ? sum : sum + weight;
    }, 0);

  const totalIsOne = weightsSumToOne(activeTotal);
  const problems = localProblems(draft, activeTotal);
  const serverIssues = validation?.issues ?? [];
  const nameMissing = name.trim() === "";
  const canPublish = problems.length === 0 && serverIssues.length === 0 && !nameMissing;

  function updateRow(uid: string, patch: Partial<DraftCriterion>) {
    setDraft((current) =>
      current === null
        ? current
        : current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
  }

  function moveRow(uid: string, delta: number) {
    setDraft((current) => {
      if (current === null) return current;
      const index = current.findIndex((row) => row.uid === uid);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Rubric</h2>
        <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
          The criteria, weights, and score ranges every review in this cycle is scored against.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Publishing creates a new version — it never edits an old one</CardTitle>
        </CardHeader>
        <CardContent className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
          <p>
            Every submitted review is pinned to the rubric version it was scored under. Publishing
            adds version <span className="font-medium text-foreground">n + 1</span> and makes it
            active; reviews already submitted keep being calculated with the weights their reviewer
            actually saw.
          </p>
          <p className="mt-2">
            That is why a version with reviews attached is read-only history rather than a document
            you revise. Nothing here rewrites a score somebody has already given.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rubric has been published for this cycle yet. The editor below starts from a blank
              criterion.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ordered.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>
                        Version {version.version} — {version.name}
                      </span>
                      {version.active ? <Badge variant="success">Active</Badge> : null}
                      {version.reviewCount > 0 ? (
                        <Badge variant="muted">
                          <Lock aria-hidden /> History
                        </Badge>
                      ) : null}
                    </p>
                    <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
                      {version.reviewCount > 0
                        ? `${version.reviewCount} submitted review${
                            version.reviewCount === 1 ? " is" : "s are"
                          } pinned to this version, so it is history: it cannot be edited or deleted.`
                        : "No review has been scored under this version yet."}{" "}
                      Published {formatDateTime(version.createdAt)}, {version.criteria.length}{" "}
                      criteri{version.criteria.length === 1 ? "on" : "a"}.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft(version.criteria.map(toDraft));
                      setName(version.name);
                      setSeededFrom(version.id);
                    }}
                  >
                    Copy version {version.version} into the editor
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Editor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-md flex-col gap-1.5">
            <Label htmlFor="rubric-name">Version name</Label>
            <Input
              id="rubric-name"
              value={name}
              aria-invalid={nameMissing}
              aria-describedby="rubric-name-hint"
              onChange={(event) => setName(event.target.value)}
            />
            <FieldHint id="rubric-name-hint">
              {nameMissing
                ? "A version needs a name so it can be told apart in the list above."
                : "Shown beside the version number in the list above."}
            </FieldHint>
          </div>

          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2"
          >
            <span className="text-sm font-medium">Active weight total</span>
            <span className="text-lg font-semibold tabular-nums">{activeTotal.toFixed(3)}</span>
            <span className="text-lg tabular-nums text-muted-foreground">
              ({formatWeightPercent(activeTotal)})
            </span>
            <span className="text-sm">
              {totalIsOne ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" aria-hidden />
                  Sums to 1 — valid
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  Must sum to exactly 1 (100%) before this can be published
                </span>
              )}
            </span>
          </div>

          <ol className="flex flex-col gap-3">
            {draft.map((row, index) => (
              <li key={row.uid}>
                <fieldset className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
                  <legend className="px-1 text-sm font-semibold">
                    Criterion {index + 1}
                    {row.label.trim() === "" ? "" : ` — ${row.label.trim()}`}
                  </legend>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-key`}>Key</Label>
                      <Input
                        id={`${row.uid}-key`}
                        value={row.key}
                        onChange={(event) => updateRow(row.uid, { key: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-label`}>Label</Label>
                      <Input
                        id={`${row.uid}-label`}
                        value={row.label}
                        onChange={(event) => updateRow(row.uid, { label: event.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${row.uid}-description`}>Description</Label>
                    <Textarea
                      id={`${row.uid}-description`}
                      className="min-h-16"
                      value={row.description}
                      onChange={(event) => updateRow(row.uid, { description: event.target.value })}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-weight`}>Weight (fraction of 1)</Label>
                      <Input
                        id={`${row.uid}-weight`}
                        inputMode="decimal"
                        value={row.weight}
                        onChange={(event) => updateRow(row.uid, { weight: event.target.value })}
                      />
                      <FieldHint>
                        {Number.isNaN(parseNumber(row.weight))
                          ? "Not a number"
                          : formatWeightPercent(parseNumber(row.weight))}
                      </FieldHint>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-min`}>Minimum score</Label>
                      <Input
                        id={`${row.uid}-min`}
                        inputMode="numeric"
                        value={row.minScore}
                        onChange={(event) => updateRow(row.uid, { minScore: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-max`}>Maximum score</Label>
                      <Input
                        id={`${row.uid}-max`}
                        inputMode="numeric"
                        value={row.maxScore}
                        onChange={(event) => updateRow(row.uid, { maxScore: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${row.uid}-source`}>Source</Label>
                      <Select
                        id={`${row.uid}-source`}
                        value={row.source}
                        onChange={(event) =>
                          updateRow(row.uid, {
                            source:
                              event.target.value === "application_preference"
                                ? "application_preference"
                                : "reviewer",
                          })
                        }
                      >
                        {CRITERION_SOURCE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`${row.uid}-active`}
                        checked={row.active}
                        onChange={(event) => updateRow(row.uid, { active: event.target.checked })}
                      />
                      <Label htmlFor={`${row.uid}-active`}>
                        Active (inactive criteria are excluded from the weight total)
                      </Label>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={index === 0}
                        aria-label={`Move criterion ${index + 1} up`}
                        onClick={() => moveRow(row.uid, -1)}
                      >
                        <ArrowUp aria-hidden /> Up
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={index === draft.length - 1}
                        aria-label={`Move criterion ${index + 1} down`}
                        onClick={() => moveRow(row.uid, 1)}
                      >
                        <ArrowDown aria-hidden /> Down
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        aria-label={`Remove criterion ${index + 1}`}
                        onClick={() =>
                          setDraft((current) =>
                            current === null
                              ? current
                              : current.filter((candidate) => candidate.uid !== row.uid),
                          )
                        }
                      >
                        <Trash2 aria-hidden /> Remove
                      </Button>
                    </div>
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>

          <div>
            <Button
              variant="outline"
              onClick={() =>
                setDraft((current) => (current === null ? current : [...current, blankCriterion()]))
              }
            >
              <Plus aria-hidden /> Add criterion
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publish</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {problems.length === 0 && serverIssues.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm">
              <Check className="size-4" aria-hidden />
              This draft is valid. Publishing it will create a new version.
            </p>
          ) : (
            <section
              aria-live="polite"
              className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
            >
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="size-4" aria-hidden />
                Publishing is blocked
              </h3>
              {problems.length === 0 ? null : (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              {serverIssues.length === 0 ? null : (
                <div>
                  <p className="text-sm font-medium">Reported by the server</p>
                  <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6">
                    {serverIssues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {nameMissing ? <p className="text-sm leading-6">This version has no name.</p> : null}
            </section>
          )}

          {confirmingPublish ? (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-600/40 bg-amber-600/5 px-4 py-3">
              <p className="text-sm font-medium">Publish “{name.trim()}” as a new version?</p>
              <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
                A published version cannot be deleted. It becomes the active rubric for reviews
                created from now on, and every review already submitted stays pinned to the version
                it was scored under.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={publish.isPending}
                  onClick={() =>
                    publish.mutate({
                      params: { path: { cycleId } },
                      body: {
                        name: name.trim(),
                        committeeId: null,
                        criteria: toCriteriaInput(draft),
                      },
                    })
                  }
                >
                  {publish.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  Yes, publish this version
                </Button>
                <Button variant="outline" onClick={() => setConfirmingPublish(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button disabled={!canPublish} onClick={() => setConfirmingPublish(true)}>
                Publish new version
              </Button>
            </div>
          )}

          {publish.isError ? (
            <ErrorState title="The rubric could not be published" error={publish.error} />
          ) : null}
          {publish.isSuccess ? (
            <p className="text-sm">
              Published version {publish.data.version} — {publish.data.name}. It is now the active
              rubric.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
