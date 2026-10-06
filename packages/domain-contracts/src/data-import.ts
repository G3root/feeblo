import * as S from "effect/Schema";

/**
 * Canonical lifecycle vocabulary for one staged board CSV import.
 *
 * The `data_import_job.status` column is plain text (not a Postgres enum) so
 * new states don't require migrations; this Effect Schema is the single source
 * of truth, and the web UI reads the same names to label a job. It lives in
 * `@feeblo/domain-contracts` for the same reason every other stored vocabulary
 * does (see `docs/adr/0002`): the database package types its column from here
 * and the browser labels it, without either importing the other.
 *
 * The lifecycle is `awaiting_confirmation -> queued -> running -> completed`,
 * with `canceled` reachable from every non-terminal state and `failed` when a
 * pass cannot continue at all. A completed job may still carry per-row errors;
 * that is the row report's job, not a different state.
 */
export const DataImportStatus = S.Literals([
  "awaiting_confirmation",
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);

export type TDataImportStatus = S.Schema.Type<typeof DataImportStatus>;

/** True for the states in which a staged import still occupies its workspace. */
export const isActiveDataImportStatus = (status: TDataImportStatus): boolean =>
  status === "awaiting_confirmation" ||
  status === "queued" ||
  status === "running";

/**
 * Canonical per-row outcome of an import.
 *
 * A row begins `pending`, becomes `created` once its post exists, or `failed`
 * and stays that way. The worker only ever applies `pending` rows, which is
 * what makes a resumed pass safe without a second identity for the row: the
 * row itself is the checkpoint.
 */
export const DataImportRowOutcome = S.Literals([
  "pending",
  "created",
  "failed",
]);

export type TDataImportRowOutcome = S.Schema.Type<typeof DataImportRowOutcome>;

/**
 * One parsed CSV row as stored in `data_import_row.payload`.
 *
 * This is a persistence representation: every field is JSON-primitive, and
 * `createdAt` is an ISO 8601 instant rather than a `Date` because jsonb has no
 * date type. The import pass parses it back into a domain value before writing
 * a post. Values are already parsed out of the CSV — titles trimmed, status
 * resolution attempted — so applying a row is a write, not a second parse.
 *
 * `statusId` is the resolved status when the file named one this workspace
 * knows, and `null` when it did not; a null status is applied with the
 * workspace's default open status and is always accompanied by a warning.
 * `warnings` are safe, workspace-authored strings (a status name, an eta
 * value) — never personal data.
 */
export const StagedDataImportRow = S.Struct({
  title: S.String,
  content: S.String,
  statusId: S.NullOr(S.String),
  tagNames: S.Array(S.String),
  etaQuarter: S.NullOr(S.String),
  authorName: S.NullOr(S.String),
  authorEmail: S.NullOr(S.String),
  /** ISO 8601 instant, or null to stamp the row at apply time. */
  createdAt: S.NullOr(S.String),
  warnings: S.Array(S.String),
});

export type TStagedDataImportRow = S.Schema.Type<typeof StagedDataImportRow>;
