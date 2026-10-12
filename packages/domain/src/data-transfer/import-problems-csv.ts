import {
  BOARD_POST_CSV_BOM,
  BOARD_POST_CSV_NEWLINE,
} from "@feeblo/domain-contracts/board-csv";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { formatCsvTextCell } from "./csv";
import {
  DataImportNotFoundError,
  type DataTransferRepositoryError,
} from "./errors";
import { canImportPosts } from "./policies";
import {
  type DataImportProblemRow,
  DataTransferRepository,
} from "./repository";

/** Rows read per database page while streaming the report. */
const PROBLEM_PAGE_SIZE = 500;

const CSV_DELIMITER = ",";
const textEncoder = new TextEncoder();

const encodeText = (text: string): Uint8Array => textEncoder.encode(text);

/** Translates one store failure to the single internal failure callers see. */
const fromReportStore = <A, R>(
  effect: Effect.Effect<A, DataTransferRepositoryError, R>
): Effect.Effect<A, InternalServerError, R> =>
  effect.pipe(
    Effect.catchTag("DataTransferRepositoryError", () =>
      Effect.fail(
        new InternalServerError({
          message: "The import store is unavailable.",
        })
      )
    )
  );

/**
 * The problems report's column contract: the row's place in the file, its
 * outcome, its plan, and the reason it needs attention. `message` is the
 * static failure reason; `warnings` names the substitutions a row imported
 * with. Both are written for a row that carries both.
 */
export const DATA_IMPORT_PROBLEMS_CSV_COLUMNS = [
  "row_number",
  "outcome",
  "title",
  "board",
  "status",
  "message",
  "warnings",
] as const;

export const DATA_IMPORT_PROBLEMS_CSV_HEADER = `${BOARD_POST_CSV_BOM}${[
  ...DATA_IMPORT_PROBLEMS_CSV_COLUMNS,
].join(CSV_DELIMITER)}${BOARD_POST_CSV_NEWLINE}`;

const rowToCells = (
  row: DataImportProblemRow
): readonly (string | number | null)[] => [
  row.rowNumber,
  row.outcome,
  row.title,
  row.boardName,
  row.statusName,
  row.message,
  row.warnings.join("; "),
];

/** Renders problem rows as CSV lines without a header. */
export const serializeDataImportProblemsCsv = (
  rows: readonly DataImportProblemRow[]
): string =>
  rows.length === 0
    ? ""
    : `${rows
        .map((row) =>
          rowToCells(row).map(formatCsvTextCell).join(CSV_DELIMITER)
        )
        .join(BOARD_POST_CSV_NEWLINE)}${BOARD_POST_CSV_NEWLINE}`;

/**
 * Streams the failed and substituted rows of one import as a CSV.
 *
 * The file is the repair sheet: it carries the row numbers of the upload, so
 * a person can fix those rows in their spreadsheet and upload the file again.
 * A job of another workspace reads as not found rather than forbidden, the
 * same rule the report itself follows. Pages are read by row number, so a
 * large import never has to fit in memory.
 */
export const streamImportProblemsCsv = (input: {
  readonly organizationId: string;
  readonly id: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* DataTransferRepository;
    const job = yield* fromReportStore(
      repository.findJob({
        id: input.id,
        organizationId: input.organizationId,
      })
    );
    if (Option.isNone(job)) {
      return yield* new DataImportNotFoundError({
        message: "No import with this id exists in this workspace.",
      });
    }

    const pages = Stream.paginate<
      number,
      DataImportProblemRow,
      InternalServerError
    >(0, (offset) =>
      fromReportStore(
        repository.listProblemRows({
          jobId: input.id,
          limit: PROBLEM_PAGE_SIZE,
          offset,
        })
      ).pipe(
        Effect.map((page) => {
          const next =
            page.length === PROBLEM_PAGE_SIZE
              ? Option.some(offset + page.length)
              : Option.none<number>();
          return [page, next] as const;
        })
      )
    );

    const now = yield* DateTime.nowAsDate;
    // The upload's own name is what a person recognizes in the download,
    // reduced to characters safe in both the header and a file system.
    const stem =
      job.value.fileName
        .replace(/\.csv$/iu, "")
        .replaceAll(/[^\p{L}\p{N}._-]+/gu, "-")
        .slice(0, 60) || input.id.slice(0, 8);
    return {
      fileName: `${stem}-import-problems-${now.toISOString().slice(0, 10)}.csv`,
      stream: Stream.concat(
        Stream.make(encodeText(DATA_IMPORT_PROBLEMS_CSV_HEADER)),
        pages.pipe(
          Stream.grouped(PROBLEM_PAGE_SIZE),
          Stream.map((rows) => encodeText(serializeDataImportProblemsCsv(rows)))
        )
      ),
    };
  }).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));
