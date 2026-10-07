import { LegidError } from "@feeblo/id";
import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";

/**
 * The file is not a board CSV this feature can read: not UTF-8 text, an
 * unterminated quote, no header row, or no `title` column. The reason is a
 * static phrase — never a value copied out of the file.
 */
export class InvalidBoardPostCsvError extends Schema.TaggedError<InvalidBoardPostCsvError>()(
  "InvalidBoardPostCsvError",
  { message: Schema.String },
  { httpApiStatus: 400, identifier: "InvalidBoardPostCsvError" }
) {}

/** The upload is larger than {@link DATA_IMPORT_MAX_BYTES}. */
export class DataImportFileTooLargeError extends Schema.TaggedError<DataImportFileTooLargeError>()(
  "DataImportFileTooLargeError",
  { maxBytes: Schema.Finite, message: Schema.String },
  { httpApiStatus: 413, identifier: "DataImportFileTooLargeError" }
) {}

/** The file carries more data rows than {@link DATA_IMPORT_MAX_ROWS}. */
export class DataImportRowLimitError extends Schema.TaggedError<DataImportRowLimitError>()(
  "DataImportRowLimitError",
  { maxRows: Schema.Finite, message: Schema.String },
  { httpApiStatus: 422, identifier: "DataImportRowLimitError" }
) {}

/**
 * The workspace already has a staged, queued, or running import. One at a
 * time keeps the tag/contact resolution and the batch writes predictable; the
 * held job can be canceled to make room.
 */
export class DataImportAlreadyActiveError extends Schema.TaggedError<DataImportAlreadyActiveError>()(
  "DataImportAlreadyActiveError",
  { message: Schema.String },
  { httpApiStatus: 409, identifier: "DataImportAlreadyActiveError" }
) {}

/**
 * The one message for a workspace that already holds an active import. Shared
 * by the service's fast-path check and the repository's unique-index mapping
 * so a raced upload reads the same way as an obvious one.
 */
export const ACTIVE_IMPORT_MESSAGE =
  "This workspace already has an import waiting to be confirmed or running. Cancel it before starting another.";

/** The job is not in `awaiting_confirmation`, so it cannot be confirmed. */
export class DataImportNotConfirmableError extends Schema.TaggedError<DataImportNotConfirmableError>()(
  "DataImportNotConfirmableError",
  { status: Schema.String, message: Schema.String },
  { httpApiStatus: 409, identifier: "DataImportNotConfirmableError" }
) {}

/** No import job with that id exists in the calling workspace. */
export class DataImportNotFoundError extends Schema.TaggedError<DataImportNotFoundError>()(
  "DataImportNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404, identifier: "DataImportNotFoundError" }
) {}

/** The board an export names does not exist in the calling workspace. */
export class DataTransferBoardNotFoundError extends Schema.TaggedError<DataTransferBoardNotFoundError>()(
  "DataTransferBoardNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404, identifier: "DataTransferBoardNotFoundError" }
) {}

/** The board holds more rows than {@link DATA_EXPORT_MAX_ROWS}. */
export class DataExportTooLargeError extends Schema.TaggedError<DataExportTooLargeError>()(
  "DataExportTooLargeError",
  { maxRows: Schema.Finite, message: Schema.String },
  { httpApiStatus: 422, identifier: "DataExportTooLargeError" }
) {}

/**
 * A worker pass could not continue (the database is unreachable, a staged row
 * is missing its payload). The job is left leased until the lease expires, so
 * a later pass can retry the rows that are still `pending`.
 */
export class DataImportPassFailedError extends Schema.TaggedError<DataImportPassFailedError>()(
  "DataImportPassFailedError",
  { message: Schema.String },
  { identifier: "DataImportPassFailedError" }
) {}

/**
 * The import store rejected an operation. Every drizzle failure the
 * persistence module can classify is normalized to this before it crosses the
 * repository's interface, so callers translate one stable failure rather than
 * driver internals.
 */
export class DataTransferRepositoryError extends Schema.TaggedError<DataTransferRepositoryError>()(
  "DataTransferRepositoryError",
  { operation: Schema.String },
  { identifier: "DataTransferRepositoryError" }
) {}

/** The RPC surface's complete expected-failure vocabulary. */
export const DataTransferServiceErrors = Schema.Union([
  UnauthorizedError,
  InternalServerError,
  PolicyDeniedError,
  BadRequestError,
  InvalidBoardPostCsvError,
  DataImportFileTooLargeError,
  DataImportRowLimitError,
  DataImportAlreadyActiveError,
  DataImportNotConfirmableError,
  DataImportNotFoundError,
  DataTransferBoardNotFoundError,
  DataExportTooLargeError,
  LegidError,
]);
