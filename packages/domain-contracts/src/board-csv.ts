/**
 * The board CSV column contract, shared by the server codec and the dashboard.
 *
 * The header is the contract: a person can open the file in a spreadsheet,
 * write a script against it, or edit it and import it back. Column names use
 * the feature's own vocabulary (`content`, not "body") so the file and the
 * dashboard cannot name the same field differently. This is deliberately not a
 * projection of the Public API's DTOs or of a dashboard response: this surface
 * carries an author email and human-readable names that neither of those
 * publishes (see `docs/adr/0004` and `docs/data-transfer.md`).
 *
 * It lives in `@feeblo/domain-contracts` because the dashboard downloads the
 * template that the server parses (ADR 0002). `@feeblo/domain`'s csv.ts
 * derives its parser and writer from these columns, so the two cannot drift.
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

/** The delimiter the header and every row use; a board CSV is comma-only. */
export const BOARD_POST_CSV_DELIMITER = ",";

/**
 * The byte-order mark the document opens with. Without it Excel reads a UTF-8
 * file as the system code page and mangles non-ASCII titles.
 */
export const BOARD_POST_CSV_BOM = "\uFEFF";

/** Excel-friendly record separator; LF is accepted on read. */
export const BOARD_POST_CSV_NEWLINE = "\r\n";

/**
 * The document's first line: the byte-order mark and the column header.
 *
 * The export stream sends it once and then one data chunk per database page —
 * a header repeated per page would be a broken file.
 */
export const BOARD_POST_CSV_HEADER = `${BOARD_POST_CSV_BOM}${[
  ...BOARD_POST_CSV_COLUMNS,
].join(BOARD_POST_CSV_DELIMITER)}${BOARD_POST_CSV_NEWLINE}`;

/**
 * The one example row the dashboard's template carries. Every column is
 * present by type, so adding a column to the contract fails this module until
 * the template names it. The values are deliberately fake and the title says
 * so: an uploader who forgets to delete the row sees exactly which post it
 * was, and the row demonstrates the two non-obvious cells — `tags` are
 * `;`-separated and `eta` is `YYYY-Qn`.
 */
const BOARD_POST_CSV_TEMPLATE_EXAMPLE = {
  author_email: "jane@example.com",
  author_name: "Jane Doe",
  board: "",
  content: "Example: a short description of the idea.",
  created_at: "2026-01-15T10:30:00.000Z",
  eta: "2026-Q1",
  status: "Open",
  tags: "example;replace-me",
  title: "Example: replace this row before uploading",
  updated_at: "",
  url: "",
  vote_count: "",
} satisfies Record<BoardPostCsvColumn, string>;

const quoteTemplateCell = (cell: string): string =>
  `"${cell.replaceAll('"', '""')}"`;

const BOARD_POST_CSV_TEMPLATE_ROW = BOARD_POST_CSV_COLUMNS.map((column) =>
  quoteTemplateCell(BOARD_POST_CSV_TEMPLATE_EXAMPLE[column])
).join(BOARD_POST_CSV_DELIMITER);

/**
 * A complete, uploadable starting file: the same header the parser accepts
 * plus one example row. The dashboard offers this as a download, which is why
 * it is exported from the contracts package rather than assembled in the
 * browser.
 */
export const BOARD_POST_CSV_TEMPLATE = `${BOARD_POST_CSV_HEADER}${BOARD_POST_CSV_TEMPLATE_ROW}${BOARD_POST_CSV_NEWLINE}`;
