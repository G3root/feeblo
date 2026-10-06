import type { TStagedDataImportRow } from "@feeblo/domain-contracts/data-import";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  POST_CONTENT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "../content-limits";
import { statusDisplayName } from "../post-status/display-name";
import type { ParsedBoardPostRow } from "./csv";

/** One status of the importing workspace, in the shape planning needs. */
export type ImportPlanStatus = {
  readonly id: string;
  readonly label: string;
  readonly type: TPostStatusType;
};

/** The board every row of the import lands in. */
export type ImportPlanBoard = {
  readonly name: string;
  readonly slug: string;
};

/** A row that can become a post, or the reason it can never become one. */
export type PlannedImportRow =
  | {
      readonly kind: "pending";
      readonly rowNumber: number;
      readonly payload: TStagedDataImportRow;
    }
  | {
      readonly kind: "failed";
      readonly rowNumber: number;
      readonly message: string;
    };

export type ImportPlan = {
  readonly rows: readonly PlannedImportRow[];
  readonly notices: readonly string[];
};

/**
 * At most one `@`, a non-empty local part, and a dotted domain part. A light
 * check on purpose: it exists to keep an obvious typo from creating a junk
 * contact, not to be the address grammar. The eventual stricter validation is
 * the resolver's when the author is written.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ETA_PATTERN = /^(\d{4})-Q([1-4])$/iu;

const normalizeKey = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

const statusLookups = (statuses: readonly ImportPlanStatus[]) => {
  const byName = new Map<string, ImportPlanStatus>();
  const byType = new Map<string, ImportPlanStatus>();
  for (const status of statuses) {
    const display = statusDisplayName(status.label, status.type);
    const displayKey = normalizeKey(display);
    if (!byName.has(displayKey)) {
      byName.set(displayKey, status);
    }
    const typeKey = normalizeKey(statusDisplayName("", status.type));
    if (!byType.has(typeKey)) {
      byType.set(typeKey, status);
    }
  }
  return { byName, byType };
};

const parseEta = (value: string) => {
  if (value.length === 0) {
    return { etaQuarter: null, warning: null };
  }
  const match = ETA_PATTERN.exec(value);
  if (match === null) {
    return {
      etaQuarter: null,
      warning: `The eta value "${value}" is not a quarter (YYYY-Qn); left empty.`,
    };
  }
  return {
    etaQuarter: `${match[1] ?? ""}-Q${match[2] ?? ""}`.toUpperCase(),
    warning: null,
  };
};

const parseInstant = (value: string) => {
  if (value.length === 0) {
    return { createdAt: null, invalid: false };
  }
  return Option.match(DateTime.make(value), {
    onNone: () => ({ createdAt: null, invalid: true }),
    onSome: (instant) => ({
      createdAt: DateTime.formatIso(instant),
      invalid: false,
    }),
  });
};

/**
 * Turns parsed rows into the plan stored on `data_import_row`.
 *
 * The rule that separates a failed row from a warning: a row fails when it
 * cannot become the post it claims to be (no title, an unreadable creation
 * instant, a value past the post limits); a row warns when it becomes a post
 * with one value substituted — an unknown status becomes the workspace's
 * default open status, an unreadable eta is left empty, an unusable author
 * email means the post has no author. Both are visible in the row report; the
 * difference is whether the post exists afterwards.
 */
export const planImportRows = ({
  rows,
  statuses,
  board,
  defaultStatus,
}: {
  readonly rows: readonly ParsedBoardPostRow[];
  readonly statuses: readonly ImportPlanStatus[];
  readonly board: ImportPlanBoard;
  readonly defaultStatus: ImportPlanStatus;
}): ImportPlan => {
  const lookups = statusLookups(statuses);
  const defaultName = statusDisplayName(
    defaultStatus.label,
    defaultStatus.type
  );

  const boardKeys = new Set([
    normalizeKey(board.name),
    normalizeKey(board.slug),
  ]);
  const foreignBoards = new Set<string>();
  for (const row of rows) {
    if (row.board.length > 0 && !boardKeys.has(normalizeKey(row.board))) {
      foreignBoards.add(row.board);
    }
  }

  const planned = rows.map((row): PlannedImportRow => {
    if (row.title.trim().length === 0) {
      return {
        kind: "failed",
        rowNumber: row.rowNumber,
        message: "The title is required.",
      };
    }
    if (row.title.length > POST_TITLE_MAX_LENGTH) {
      return {
        kind: "failed",
        rowNumber: row.rowNumber,
        message: `The title is longer than ${POST_TITLE_MAX_LENGTH} characters.`,
      };
    }
    if (row.content.length > POST_CONTENT_MAX_LENGTH) {
      return {
        kind: "failed",
        rowNumber: row.rowNumber,
        message: `The content is longer than ${POST_CONTENT_MAX_LENGTH} characters.`,
      };
    }

    const warnings: string[] = [];

    const matchedStatus =
      row.status.length === 0
        ? undefined
        : (lookups.byName.get(normalizeKey(row.status)) ??
          lookups.byType.get(normalizeKey(row.status)));
    if (row.status.length === 0) {
      warnings.push(`The status is empty; imported as "${defaultName}".`);
    } else if (matchedStatus === undefined) {
      warnings.push(
        `The status "${row.status}" is not one of this workspace's statuses; imported as "${defaultName}".`
      );
    }

    const eta = parseEta(row.eta);
    if (eta.warning !== null) {
      warnings.push(eta.warning);
    }

    const instant = parseInstant(row.createdAt);
    if (instant.invalid) {
      return {
        kind: "failed",
        rowNumber: row.rowNumber,
        message: "The created_at value is not an ISO 8601 instant.",
      };
    }

    const authorName = row.authorName.length > 0 ? row.authorName : null;
    let authorEmail = row.authorEmail.length > 0 ? row.authorEmail : null;
    if (authorEmail !== null && !EMAIL_PATTERN.test(authorEmail)) {
      warnings.push(
        "The author email is not a valid address; the post imports without an author."
      );
      authorEmail = null;
    } else if (authorEmail === null && authorName !== null) {
      warnings.push(
        "The author name has no email; the post imports without an author."
      );
    }

    return {
      kind: "pending",
      rowNumber: row.rowNumber,
      payload: {
        title: row.title,
        content: row.content,
        statusId: matchedStatus?.id ?? null,
        tagNames: row.tags,
        etaQuarter: eta.etaQuarter,
        authorName: authorEmail === null ? null : authorName,
        authorEmail,
        createdAt: instant.createdAt,
        warnings,
      },
    };
  });

  const notices =
    foreignBoards.size === 0
      ? []
      : [
          `The file names ${foreignBoards.size === 1 ? "a different board" : `${foreignBoards.size} other boards`}; all rows import into "${board.name}".`,
        ];

  return { notices, rows: planned };
};
