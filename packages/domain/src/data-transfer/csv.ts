import { isNumber } from "@feeblo/utils/runtime-kind";
import * as Effect from "effect/Effect";

import { DataImportRowLimitError, InvalidBoardPostCsvError } from "./errors";
import { DATA_IMPORT_MAX_ROWS } from "./limits";

/**
 * The board-posts CSV codec.
 *
 * The parser, writer, byte-order-mark decoding and formula-injection escape
 * are ported from `hucre`'s `src/csv` (https://github.com/productdevbook/hucre,
 * MIT License, Copyright (c) 2026 productdevbook). Only what this feature
 * needs is carried over — the fetch/stream transports, delimiter detection,
 * type inference and object projection stay behind, because a board CSV has a
 * fixed comma-delimited column contract.
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
const DELIMITER = ",";
const QUOTE = '"';
const TAG_SEPARATOR = ";";

// ── Formula-injection escaping (ported from hucre's csv/formula.ts) ──

/**
 * Characters a spreadsheet treats as the start of a formula: operators,
 * whitespace injection and a null byte. Kept beside the inverse so the two
 * cannot disagree about what the writer escaped.
 */
const FORMULA_PREFIXES = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
  "\n",
  "\0",
  "|",
]);

/** DDE and data-exfiltration functions, matched case-insensitively. */
const DANGEROUS_PATTERNS = [
  /^=cmd\b/iu,
  /^=HYPERLINK\s*\(/iu,
  /^=IMPORTXML\s*\(/iu,
  /^=IMPORTDATA\s*\(/iu,
  /^=IMPORTFEED\s*\(/iu,
  /^=IMPORTHTML\s*\(/iu,
  /^=IMPORTRANGE\s*\(/iu,
  /^=IMAGE\s*\(/iu,
];

/** Prefix a value with an apostrophe when a spreadsheet would evaluate it. */
const escapeFormula = (value: string): string => {
  if (value.length === 0) {
    return value;
  }
  if (FORMULA_PREFIXES.has(value[0] ?? "")) {
    return `'${value}`;
  }
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(value))
    ? `'${value}`
    : value;
};

/**
 * Undo {@link escapeFormula}: drop a leading apostrophe only when the
 * character behind it is one the writer escapes for, so an apostrophe a human
 * typed stays where it is.
 */
const unescapeFormula = (value: string): string =>
  value.startsWith("'") && FORMULA_PREFIXES.has(value[1] ?? "")
    ? value.slice(1)
    : value;

// ── Input decoding (ported from hucre's csv/encoding.ts) ─────────────

type BomEncoding = "utf-8" | "utf-16le" | "utf-16be";

/**
 * What the byte-order mark says the file is, if it carries one.
 *
 * `utf-16le` is the one worth knowing about: it is what Excel's "Save as
 * Unicode Text" produces, and a UTF-8 decoder reads it as NUL-separated
 * letters rather than rejecting it.
 */
const detectBom = (
  bytes: Uint8Array
): { readonly encoding: BomEncoding; readonly length: number } | null => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return { encoding: "utf-8", length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", length: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", length: 2 };
  }
  return null;
};

/**
 * Decodes an uploaded file into text.
 *
 * The mark decides when there is one; otherwise the bytes must be valid
 * UTF-8, and a decode failure is the file telling us it is neither UTF-8 nor
 * a marked UTF-16 document — not something to paper over with replacement
 * characters that would reach a post's title.
 */
export const decodeBoardPostCsv = (
  bytes: Uint8Array
): Effect.Effect<string, InvalidBoardPostCsvError> =>
  Effect.tryPromise({
    try: async () => {
      const bom = detectBom(bytes);
      const decoder = new TextDecoder(bom?.encoding ?? "utf-8", {
        fatal: true,
        ignoreBOM: false,
      });
      return decoder.decode(bom === null ? bytes : bytes.subarray(bom.length));
    },
    catch: () =>
      new InvalidBoardPostCsvError({
        message: "The file could not be decoded as UTF-8 or UTF-16 text.",
      }),
  });

// ── Cells (ported from hucre's csv/writer.ts) ───────────────────────

type BoardPostCsvCell = string | number | Date | null;

const needsQuoting = (value: string): boolean =>
  value.includes(DELIMITER) ||
  value.includes(QUOTE) ||
  value.includes("\r") ||
  value.includes("\n") ||
  value.trim() !== value;

const quoteCsvCell = (value: string): string =>
  `${QUOTE}${value.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`;

const quoteField = (value: string): string =>
  needsQuoting(value) ? quoteCsvCell(value) : value;

/**
 * Renders a number without exponent notation where the plain form is the same
 * number: `1e-07` reads as text in some importers, but a prettier rendering is
 * not worth a different value, so the expansion is checked before it is used.
 */
const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const magnitude = Math.abs(value);
  if (Number.isInteger(value) && magnitude >= 1e15) {
    const plain = value.toFixed(0);
    if (Number(plain) === value) {
      return plain;
    }
  }
  if (magnitude > 0 && magnitude < 1e-6) {
    const plain = value.toFixed(20).replace(/0+$/u, "").replace(/\.$/u, ".0");
    if (Number(plain) === value) {
      return plain;
    }
  }
  return String(value);
};

const formatDate = (value: Date): string =>
  Number.isNaN(value.getTime()) ? "" : value.toISOString();

/**
 * One cell as its CSV text.
 *
 * Escaping is column-independent because the typing does the work: a number
 * or a `Date` is rendered by its own formatter, so only free text can begin
 * with a formula trigger. An escaped value is quoted as well as prefixed —
 * a bare leading apostrophe is dropped by some readers, and the marker has to
 * survive the round trip to be removable.
 */
const formatCsvCell = (value: BoardPostCsvCell): string => {
  if (value === null) {
    return "";
  }
  if (isNumber(value)) {
    return formatNumber(value);
  }
  if (value instanceof Date) {
    return formatDate(value);
  }
  const escaped = escapeFormula(value);
  return escaped === value ? quoteField(value) : quoteCsvCell(escaped);
};

const rowToCells = (row: BoardPostCsvRow): readonly BoardPostCsvCell[] => [
  row.title,
  row.content,
  row.status,
  row.board,
  row.tags.join(TAG_SEPARATOR),
  row.eta,
  row.authorName,
  row.authorEmail,
  row.voteCount,
  row.createdAt,
  row.updatedAt,
  row.url,
];

// ── The document ────────────────────────────────────────────────────

/**
 * The document's first line: the byte-order mark and the column header.
 *
 * Exported so the export stream can send it once and then one data chunk per
 * database page — a header repeated per page would be a broken file.
 */
export const BOARD_POST_CSV_HEADER = `${UTF8_BOM}${[...BOARD_POST_CSV_COLUMNS].join(DELIMITER)}${CRLF}`;

/** Renders data rows as CSV lines without a header. */
export const serializeBoardPostCsvRows = (
  rows: readonly BoardPostCsvRow[]
): string =>
  rows.length === 0
    ? ""
    : `${rows
        .map((row) => rowToCells(row).map(formatCsvCell).join(DELIMITER))
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

// ── Reading (ported from hucre's csv/reader.ts) ─────────────────────

type CsvRecord = {
  readonly cells: readonly string[];
  /**
   * Whether the record's first cell was opened with a quote. A blank line and
   * an explicit empty quoted value both parse to `[""]`; only the first is
   * not a row.
   */
  readonly firstFieldQuoted: boolean;
  /** The physical line the record starts on; the header is line 1. */
  readonly lineNumber: number;
};

const parseRecords = (
  input: string
):
  | { readonly records: readonly CsvRecord[] }
  | { readonly unterminated: true } => {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let firstFieldQuoted = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  const pushCell = () => {
    cells.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    records.push({ cells, firstFieldQuoted, lineNumber: recordLine });
    cells = [];
    firstFieldQuoted = false;
  };

  while (index < input.length) {
    const character = input[index] ?? "";

    if (inQuotes) {
      if (character === QUOTE) {
        if (input[index + 1] === QUOTE) {
          field += QUOTE;
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (character === "\n") {
        line += 1;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === QUOTE && field === "") {
      inQuotes = true;
      fieldWasQuoted = true;
      index += 1;
      continue;
    }

    if (character === DELIMITER) {
      if (cells.length === 0) {
        firstFieldQuoted = fieldWasQuoted;
      }
      pushCell();
      index += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (cells.length === 0) {
        firstFieldQuoted = fieldWasQuoted;
      }
      pushCell();
      pushRecord();
      line += 1;
      recordLine = line;
      index += character === "\r" && input[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += character;
    index += 1;
  }

  if (inQuotes) {
    return { unterminated: true };
  }
  if (field !== "" || cells.length > 0 || fieldWasQuoted) {
    if (cells.length === 0) {
      firstFieldQuoted = fieldWasQuoted;
    }
    pushCell();
    pushRecord();
  }
  return { records };
};

const normalizeColumnName = (cell: string): string =>
  cell.trim().toLowerCase().replaceAll("-", "_");

/**
 * The columns whose values are human free text, and therefore the only ones
 * the formula escape applies to. `vote_count` and the timestamps are
 * generated here (a number and ISO instants); unescaping them would eat an
 * apostrophe that was part of the value.
 */
const FREE_TEXT_COLUMNS: ReadonlySet<BoardPostCsvColumn> = new Set([
  "title",
  "content",
  "status",
  "board",
  "tags",
  "eta",
  "author_name",
  "author_email",
  "url",
]);

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
 * leading byte-order mark is stripped — but a file with no header, no `title`
 * column, an unterminated quote, or more rows than the cap is rejected as a
 * whole rather than half-staged. A free-text value the exporter escaped for a
 * spreadsheet is unescaped here, so an export round-trips unchanged.
 */
export const parseBoardPostCsv = (
  source: string
): Effect.Effect<
  ParsedBoardPostCsv,
  InvalidBoardPostCsvError | DataImportRowLimitError
> =>
  Effect.gen(function* () {
    const parsed = parseRecords(source);
    if ("unterminated" in parsed) {
      return yield* new InvalidBoardPostCsvError({
        message:
          "The file has an unterminated quoted value. Check for a missing closing quote.",
      });
    }
    const records = parsed.records.filter(
      (record) =>
        !(
          record.cells.length === 1 &&
          record.cells[0] === "" &&
          !record.firstFieldQuoted
        )
    );
    const [header, ...dataRecords] = records;
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
        const raw =
          index === undefined ? "" : (record.cells[index] ?? "").trim();
        return FREE_TEXT_COLUMNS.has(column) ? unescapeFormula(raw) : raw;
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
