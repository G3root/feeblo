/**
 * The bounded shape of a board CSV transfer.
 *
 * Constants rather than configuration on purpose: these are the product's
 * stated limits, not deployment tuning. The import caps are enforced both
 * while reading the upload (bytes) and after parsing it (rows); the export cap
 * is enforced before the first byte is streamed, so "too large" can still be
 * a normal error response rather than a truncated download.
 */

/** Largest upload this feature reads, checked before the file is read. */
export const DATA_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Largest number of data rows one import may carry. */
export const DATA_IMPORT_MAX_ROWS = 20_000;

/** Largest number of rows one export may stream. */
export const DATA_EXPORT_MAX_ROWS = 20_000;

/** Rows applied per transaction by the worker. */
export const DATA_IMPORT_BATCH_SIZE = 100;

/** How long a claim owns a job before another worker may take it over. */
export const DATA_IMPORT_LEASE_MS = 60_000;

/** How long a finished job's rows stay readable, matching delivery retention. */
export const DATA_IMPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Delay between claim attempts when there is no work. */
export const DATA_IMPORT_POLL_MS = 1_000;

/** How often a live import stream re-reads what it is watching. */
export const DATA_IMPORT_WATCH_MS = 1_000;
