import * as Effect from "effect/Effect";

import { DataImportRowLimitError, InvalidBoardPostCsvError } from "./errors";
import { DATA_IMPORT_MAX_ROWS } from "./limits";

/**
 * The board-posts CSV contract.
 *
 * The header is the contract: a person can open the file in a spreadsheet,
 * write a script against it, or edit it and import it back. Column names use
 * the feature's own vocabulary (`content`, not "body") so the file and the
 * dashboard cannot name the same field differently. This is deliberately not a
 * projection of the Public API's DTOs or of a dashboard response: this surface
 * carries an author email and human-readable names that neither of those
 * publishes (see `docs/adr/0004` and `docs/data-transfer.md`).
 *
 * `vote_count`, `updated_at`, and `url` are read-only decoration — import
 * ignores them, because a file cannot fabricate a vote, a history, or a link.
 */
export const BOARD_POST_CSV_COLUMNS = [
  "title",
  "content",
  "status",
  "board",
  "tags",
  "eta",
  "author_name",
  "author_email",
  "vote_count",
  "created_at",
  "updated_at",
  "url",
] as const;

export type BoardPostCsvColumn = (typeof BOARD_POST_CSV_COLUMNS)[number];

/** One row of an export, already resolved from the database. */
export type BoardPostCsvRow = {
  readonly title: string;
  readonly content: string;
  /** The display name: the status label, or the humanized type when unset. */
  readonly status: string;
  readonly board: string;
  readonly tags: readonly string[];
  readonly eta: string | null;
  readonly authorName: string | null;
  readonly authorEmail: string | null;
  readonly voteCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly url: string | null;
};

/** One data row as read from an upload, before anything is resolved. */
export type ParsedBoardPostRow = {
  /**
   * The physical line the record starts on, counting the header as line 1.
   * Reporting the line rather than a data-row ordinal means the report's row
   * number matches what the uploader sees in their spreadsheet.
   */
  readonly rowNumber: number;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly board: string;
  readonly tags: readonly string[];
  readonly eta: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly voteCount: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
};

export type ParsedBoardPostCsv = {
  readonly rows: readonly ParsedBoardPostRow[];
  /** File-level notes shown before confirmation; never personal data. */
  readonly notices: readonly string[];
};

const UTF8_BOM = "\uFEFF";
const CRLF = "\r\n";
const TAG_SEPARATOR = ";";

const needsQuoting = (value: string): boolean =>
  value.includes(",") ||
  value.includes('"') ||
  value.includes("\r") ||
  value.includes("\n") ||
  value.trim() !== value;

const escapeCsvCell = (value: string): string =>
  needsQuoting(value) ? `"${value.replaceAll('"', '""')}"` : value;

const rowToCells = (row: BoardPostCsvRow): readonly string[] => [
  row.title,
  row.content,
  row.status,
  row.board,
  row.tags.join(TAG_SEPARATOR),
  row.eta ?? "",
  row.authorName ?? "",
  row.authorEmail ?? "",
  String(row.voteCount),
  row.createdAt.toISOString(),
  row.updatedAt.toISOString(),
  row.url ?? "",
];

/**
 * The document's first line: the byte-order mark and the column header.
 *
 * Exported so the export stream can send it once and then one data chunk per
 * database page — a header repeated per page would be a broken file.
 */
export const BOARD_POST_CSV_HEADER = `${UTF8_BOM}${[...BOARD_POST_CSV_COLUMNS].join(",")}${CRLF}`;

/** Renders data rows as CSV lines without a header. */
export const serializeBoardPostCsvRows = (
  rows: readonly BoardPostCsvRow[]
): string =>
  rows.length === 0
    ? ""
    : `${rows
        .map((row) => rowToCells(row).map(escapeCsvCell).join(","))
        .join(CRLF)}${CRLF}`;

/**
 * Renders rows as a complete, Excel-friendly CSV document: UTF-8 with a
 * byte-order mark, CRLF record separators, and RFC 4180 quoting. The BOM is
 * part of the document on purpose — without it Excel reads a UTF-8 file as the
 * system code page and mangles non-ASCII titles.
 */
export const serializeBoardPostCsv = (
  rows: readonly BoardPostCsvRow[]
): string => `${BOARD_POST_CSV_HEADER}${serializeBoardPostCsvRows(rows)}`;

type CsvRecord = {
  readonly lineNumber: number;
  readonly cells: readonly string[];
};

const splitCsvRecords = (
  source: string
):
  | { readonly records: readonly CsvRecord[] }
  | { readonly unterminated: true } => {
  const text = source.startsWith(UTF8_BOM) ? source.slice(1) : source;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
  };

  const endRecord = () => {
    endField();
    const record: CsvRecord = { cells, lineNumber: recordLine };
    // A blank line is not a row; a line of empty cells is.
    if (!(record.cells.length === 1 && record.cells[0] === "")) {
      records.push(record);
    }
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) {
      continue;
    }

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") {
          line += 1;
        }
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      endField();
      continue;
    }
    if (character === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (character === "\r") {
      // CRLF is handled by the following `\n`; a lone CR stays in the field.
      if (text[index + 1] === "\n") {
        continue;
      }
      field += character;
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    return { unterminated: true };
  }
  if (field.length > 0 || cells.length > 0) {
    endRecord();
  }
  return { records };
};

const normalizeColumnName = (cell: string): string =>
  cell.trim().toLowerCase().replaceAll("-", "_");

/** The header names this contract understands, keyed by their normalized form. */
const BOARD_POST_CSV_COLUMN_BY_NAME: ReadonlyMap<string, BoardPostCsvColumn> =
  new Map(
    BOARD_POST_CSV_COLUMNS.map((column) => [
      normalizeColumnName(column),
      column,
    ])
  );

const dedupeTags = (names: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(name);
    }
  }
  return tags;
};

const splitTagCell = (cell: string): readonly string[] =>
  dedupeTags(
    cell
      .split(TAG_SEPARATOR)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
  );

/**
 * Parses an uploaded board CSV.
 *
 * Reading is lenient about presentation and strict about meaning: unknown
 * columns are ignored with a notice, LF and CRLF are both accepted, and a
 * leading BOM is stripped — but a file with no header, no `title` column, an
 * unterminated quote, or more rows than the cap is rejected as a whole rather
 * than half-staged. Value-level problems (an unknown status, a malformed eta)
 * belong to planning, not to the reader.
 */
export const parseBoardPostCsv = (
  source: string
): Effect.Effect<
  ParsedBoardPostCsv,
  InvalidBoardPostCsvError | DataImportRowLimitError
> =>
  Effect.gen(function* () {
    const split = splitCsvRecords(source);
    if ("unterminated" in split) {
      return yield* new InvalidBoardPostCsvError({
        message:
          "The file has an unterminated quoted value. Check for a missing closing quote.",
      });
    }
    const [header, ...dataRecords] = split.records;
    if (header === undefined) {
      return yield* new InvalidBoardPostCsvError({
        message: "The file is empty. Expected a header row and data rows.",
      });
    }

    const columnIndex = new Map<BoardPostCsvColumn, number>();
    const unknownColumns: string[] = [];
    header.cells.forEach((cell, index) => {
      const name = normalizeColumnName(cell);
      const column = BOARD_POST_CSV_COLUMN_BY_NAME.get(name);
      if (column !== undefined) {
        // First occurrence wins; a duplicated header would otherwise make
        // which value applies depend on column order.
        if (!columnIndex.has(column)) {
          columnIndex.set(column, index);
        }
        return;
      }
      if (name.length > 0) {
        unknownColumns.push(cell.trim());
      }
    });

    if (!columnIndex.has("title")) {
      return yield* new InvalidBoardPostCsvError({
        message:
          "The file has no title column. Expected a header row naming at least title.",
      });
    }
    if (dataRecords.length > DATA_IMPORT_MAX_ROWS) {
      return yield* new DataImportRowLimitError({
        maxRows: DATA_IMPORT_MAX_ROWS,
        message: `The file has ${dataRecords.length} data rows; the limit is ${DATA_IMPORT_MAX_ROWS}.`,
      });
    }

    const rows = dataRecords.map((record): ParsedBoardPostRow => {
      const value = (column: BoardPostCsvColumn): string => {
        const index = columnIndex.get(column);
        return index === undefined ? "" : (record.cells[index] ?? "").trim();
      };
      return {
        rowNumber: record.lineNumber,
        title: value("title"),
        content: value("content"),
        status: value("status"),
        board: value("board"),
        tags: splitTagCell(value("tags")),
        eta: value("eta"),
        authorName: value("author_name"),
        authorEmail: value("author_email").toLowerCase(),
        voteCount: value("vote_count"),
        createdAt: value("created_at"),
        updatedAt: value("updated_at"),
        url: value("url"),
      };
    });

    const notices: string[] = [];
    if (unknownColumns.length > 0) {
      notices.push(
        `Ignoring unknown column${unknownColumns.length === 1 ? "" : "s"}: ${unknownColumns.join(", ")}.`
      );
    }

    return { notices, rows };
  });
