import { canImportApplications } from "@labrador/access-control";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { EmptyState, ErrorState } from "@/components/recruitment/StateViews.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { FieldHint, Label } from "@/components/ui/field.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { useRecruitmentUser } from "@/hooks/useRecruitmentUser.ts";
import { $api } from "@/lib/apiClient";
import {
  formatDateTime,
  formatFileSize,
  type ImportPreview,
  type ImportRowResult,
  type ImportSummary,
} from "@/lib/recruitment.ts";

export const Route = createFileRoute("/recruitment/$cycleId/import")({
  component: ImportPage,
});

/** The `ok: false` half of the per-row union, which is the half that needs a table. */
type FailedRow = Extract<ImportRowResult, { ok: false }>;

function isFailedRow(result: ImportRowResult): result is FailedRow {
  return !result.ok;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Parsed, not committed",
  previewed: "Previewed, not committed",
  committed: "Committed",
  failed: "Failed",
};

const ROW_STATUS_LABELS: Record<string, string> = {
  imported: "Created",
  updated: "Updated",
  skipped: "Skipped, unchanged",
  pending: "Not committed",
  error: "Error",
};

function ImportPage() {
  const { cycleId } = Route.useParams();
  const { user, isLoaded } = useRecruitmentUser(cycleId);
  const mayImport = canImportApplications({ user });

  const [file, setFile] = useState<File | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmingCommit, setConfirmingCommit] = useState(false);
  const [openImportId, setOpenImportId] = useState<string | null>(null);

  const history = $api.useQuery(
    "get",
    "/recruitment/cycles/{cycleId}/imports",
    { params: { path: { cycleId } } },
    { enabled: mayImport },
  );

  const createImport = $api.useMutation("post", "/recruitment/cycles/{cycleId}/imports", {
    onSuccess: () => {
      setConfirmingCommit(false);
      void history.refetch();
    },
  });

  const commitImport = $api.useMutation("post", "/recruitment/imports/{importId}/commit", {
    onSuccess: () => {
      setConfirmingCommit(false);
      void history.refetch();
    },
  });

  const rows = $api.useQuery(
    "get",
    "/recruitment/imports/{importId}/rows",
    { params: { path: { importId: openImportId ?? "" } } },
    { enabled: openImportId !== null },
  );

  if (isLoaded && !mayImport) {
    return (
      <EmptyState title="Importing applications is a recruitment-admin action">
        <p className="max-w-[62ch] text-[0.95rem] leading-7 text-muted-foreground">
          Only a recruitment admin can upload an application export, because a commit writes
          applicants and candidacies for the whole cycle. Ask one to run the import, or to grant you
          the recruitment-admin role in this cycle.
        </p>
      </EmptyState>
    );
  }

  const preview = createImport.data?.preview;
  const importId = createImport.data?.importId ?? null;
  const report = commitImport.data;

  async function handleUpload() {
    if (file === null) return;
    setReadError(null);

    let contentBase64: string;
    try {
      contentBase64 = await readAsBase64(file);
    } catch {
      setReadError("The file could not be read from disk. Choose it again and retry.");
      return;
    }

    commitImport.reset();
    createImport.mutate({
      params: { path: { cycleId } },
      body: { filename: file.name, contentBase64 },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Import applications</h2>
        <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
          Upload the form export, check the mapping preview, then commit. Nothing is written to the
          application tables until you press Commit.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Re-importing the same file is safe</CardTitle>
        </CardHeader>
        <CardContent className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
          <p>
            An applicant is identified by their email within this cycle, so importing an updated
            export <strong className="font-medium text-foreground">updates</strong> the rows that
            changed rather than creating a second copy of anyone. A row whose content is unchanged
            is skipped outright.
          </p>
          <p className="mt-2">
            An import never deletes a candidacy and never touches a review. Reviews already
            submitted stay exactly as their reviewer left them, so re-running an import to correct a
            typo cannot cost you review work.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Choose a file</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">Application export file</Label>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.csv"
              aria-describedby="import-file-hint"
              className="w-full max-w-md rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setReadError(null);
              }}
            />
            <FieldHint id="import-file-hint">
              A `.xlsx` or `.csv` export of the application form. The file is read in your browser
              and sent as part of the request; it is never uploaded anywhere else.
            </FieldHint>
          </div>

          {file === null ? (
            <p className="text-sm text-muted-foreground">No file chosen yet.</p>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
            </p>
          )}

          <div>
            <Button
              disabled={file === null || createImport.isPending}
              onClick={() => {
                void handleUpload();
              }}
            >
              {createImport.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              Upload and preview
            </Button>
          </div>

          {readError === null ? null : (
            <ErrorState title="Could not read the file" error={readError} />
          )}
          {createImport.isError ? (
            <ErrorState title="The upload could not be parsed" error={createImport.error} />
          ) : null}
        </CardContent>
      </Card>

      {preview === undefined ? null : <PreviewSection preview={preview} />}

      {preview === undefined || importId === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Step 3 — Commit</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
              Committing writes {preview.okCount} applicant and application record
              {preview.okCount === 1 ? "" : "s"} into this cycle and creates candidacies from the
              committee preferences on each row. Rows that failed validation are not written.
            </p>
            {confirmingCommit ? (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-600/40 bg-amber-600/5 px-4 py-3">
                <p className="text-sm font-medium">
                  Write {preview.okCount} row{preview.okCount === 1 ? "" : "s"} to this cycle?
                </p>
                <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
                  Applicants and candidacies are created or updated. No candidacy is deleted and no
                  review is altered, so this is reversible by importing a corrected file.
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={commitImport.isPending}
                    onClick={() => {
                      commitImport.mutate({ params: { path: { importId } } });
                    }}
                  >
                    {commitImport.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    Yes, commit this import
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmingCommit(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button onClick={() => setConfirmingCommit(true)} disabled={report !== undefined}>
                  Commit import
                </Button>
              </div>
            )}

            {commitImport.isError ? (
              <ErrorState title="The commit failed" error={commitImport.error} />
            ) : null}

            {report === undefined ? null : (
              <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Commit report</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <ReportEntry label="Created" value={report.created} />
                  <ReportEntry label="Updated" value={report.updated} />
                  <ReportEntry label="Skipped" value={report.skipped} />
                  <ReportEntry label="Errors" value={report.errors} />
                  <ReportEntry label="Candidacies created" value={report.candidaciesCreated} />
                  <ReportEntry label="Rows read" value={report.rowCount} />
                </dl>
                {report.unknownCommitteeSlugs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Every committee named in the file is one this cycle runs.
                  </p>
                ) : (
                  <div>
                    <p className="text-sm font-medium">
                      Committees named in the file that this cycle does not run
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Preferences for these were ignored, so no candidacy was created for them:{" "}
                      {report.unknownCommitteeSlugs.join(", ")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Previous imports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {history.isError ? (
            <ErrorState title="Could not load the import history" error={history.error} />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No file has been imported into this cycle yet.
            </p>
          ) : (
            <HistoryTable
              imports={history.data ?? []}
              openImportId={openImportId}
              onToggle={(id) => setOpenImportId((current) => (current === id ? null : id))}
            />
          )}

          {openImportId === null ? null : rows.isError ? (
            <ErrorState title="Could not load the rows of that import" error={rows.error} />
          ) : rows.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading per-row outcomes…</p>
          ) : (
            <div>
              <h3 className="mb-1.5 text-sm font-semibold">Per-row outcomes</h3>
              {(rows.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  That import recorded no rows, which means the file held no data rows.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Source row</TableHead>
                      <TableHead scope="col">Outcome</TableHead>
                      <TableHead scope="col">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rows.data ?? []).map((row) => (
                      <TableRow key={`${row.sourceRowNumber}-${row.applicationId}`}>
                        <TableCell className="tabular-nums">{row.sourceRowNumber}</TableCell>
                        <TableCell>{ROW_STATUS_LABELS[row.status] ?? row.status}</TableCell>
                        <TableCell className="max-w-120 whitespace-normal">
                          {row.errorMessage === "" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            row.errorMessage
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportEntry({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function PreviewSection({ preview }: { preview: ImportPreview }) {
  const failedRows = preview.results.filter(isFailedRow);
  const mappingBroken =
    preview.mapping.unmappedHeaders.length > 0 || preview.mapping.missingHeaders.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 — Preview</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <CountTile label="Rows read" value={preview.rowCount} />
          <CountTile label="Rows that would import" value={preview.okCount} />
          <CountTile label="Rows with errors" value={preview.errorCount} />
        </dl>
        <p className="text-sm text-muted-foreground">
          Sheet <span className="font-medium text-foreground">{preview.sheetName}</span>,{" "}
          {preview.mapping.fields.length} column
          {preview.mapping.fields.length === 1 ? "" : "s"} matched.
        </p>

        {mappingBroken ? (
          <section
            role="alert"
            className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
          >
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
              Column mapping problem — check this before committing
            </h3>
            <p className="max-w-[80ch] text-sm leading-6">
              A column that was renamed in the form still uploads cleanly; it simply arrives empty.
              That is why these two lists are worth reading in full.
            </p>
            {preview.mapping.missingHeaders.length === 0 ? null : (
              <div>
                <p className="text-sm font-medium">
                  Expected columns the sheet did not supply ({preview.mapping.missingHeaders.length}
                  )
                </p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6">
                  {preview.mapping.missingHeaders.map((header) => (
                    <li key={header}>{header}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.mapping.unmappedHeaders.length === 0 ? null : (
              <div>
                <p className="text-sm font-medium">
                  Columns in the sheet that nothing matched (
                  {preview.mapping.unmappedHeaders.length})
                </p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6">
                  {preview.mapping.unmappedHeaders.map((header) => (
                    <li key={header}>{header}</li>
                  ))}
                </ul>
                <p className="mt-1 max-w-[80ch] text-sm leading-6 text-muted-foreground">
                  An unmatched column paired with a missing one usually means the same question was
                  simply renamed. Rename it back in the sheet and upload again.
                </p>
              </div>
            )}
          </section>
        ) : (
          <p className="flex items-center gap-1.5 rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-4 py-3 text-sm">
            <Check className="size-4" aria-hidden />
            Every expected column was matched, and no column in the sheet was left unrecognised.
          </p>
        )}

        <div>
          <h3 className="text-sm font-semibold">Duplicate emails</h3>
          {preview.duplicateEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No email appears on more than one row of this file.
            </p>
          ) : (
            <>
              <p className="max-w-[80ch] text-sm leading-6 text-muted-foreground">
                These emails appear on more than one row. Each is one applicant, so only the row the
                importer keeps will survive the commit.
              </p>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-6">
                {preview.duplicateEmails.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3 className="mb-1.5 text-sm font-semibold">
            Rows that would not import ({failedRows.length})
          </h3>
          {failedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every row passed validation.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Source row</TableHead>
                  <TableHead scope="col">Column</TableHead>
                  <TableHead scope="col">Problem</TableHead>
                  <TableHead scope="col">Cell value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedRows.flatMap((row) =>
                  row.errors.map((error) => (
                    <TableRow key={`${row.sourceRowNumber}-${error.field}-${error.message}`}>
                      <TableCell className="tabular-nums">{row.sourceRowNumber}</TableCell>
                      <TableCell className="font-medium">{error.column}</TableCell>
                      <TableCell className="max-w-100 whitespace-normal">{error.message}</TableCell>
                      <TableCell className="max-w-60 truncate">
                        {error.value === null || error.value === "" ? (
                          <span className="text-muted-foreground">empty</span>
                        ) : (
                          error.value
                        )}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

interface HistoryTableProps {
  imports: ImportSummary[];
  openImportId: string | null;
  onToggle: (importId: string) => void;
}

function HistoryTable({ imports, openImportId, onToggle }: HistoryTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">File</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">Rows</TableHead>
          <TableHead scope="col">Succeeded</TableHead>
          <TableHead scope="col">Errors</TableHead>
          <TableHead scope="col">Uploaded at</TableHead>
          <TableHead scope="col">Committed at</TableHead>
          <TableHead scope="col">Per-row detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {imports.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.filename}</TableCell>
            <TableCell>
              <Badge variant={item.status === "committed" ? "success" : "muted"}>
                {STATUS_LABELS[item.status] ?? item.status}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">{item.rowCount}</TableCell>
            <TableCell className="tabular-nums">{item.successCount}</TableCell>
            <TableCell className="tabular-nums">{item.errorCount}</TableCell>
            <TableCell>{formatDateTime(item.createdAt)}</TableCell>
            <TableCell>{formatDateTime(item.committedAt)}</TableCell>
            <TableCell>
              <Button
                variant="outline"
                size="sm"
                aria-expanded={openImportId === item.id}
                onClick={() => onToggle(item.id)}
              >
                {openImportId === item.id ? "Hide rows" : `Show rows of ${item.filename}`}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Reads the chosen file and base64-encodes it for the JSON body.
 *
 * `btoa` takes a binary string, so the bytes are walked in chunks rather than
 * spread in one call: a spread of a few hundred thousand arguments overflows the
 * call stack, and a full form export is comfortably that large.
 */
async function readAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK_SIZE = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }

  return btoa(binary);
}
