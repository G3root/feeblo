import * as S from "effect/Schema";

import { POST_STATUS_TYPES, PostStatusType } from "./post-status-type";

/**
 * The board's query vocabulary, shared by the dashboard store, the board's live
 * query, and the saved-view write path.
 *
 * Before this file existed the same filter state was restated three times: the
 * xstate store in `apps/web`, the live-query callback that consumed it, and
 * (for saved views) nothing at all. A saved view makes the shape a persisted
 * contract, so it has one definition here and every other site derives from
 * it — `BoardView` in the dashboard store is the schema type plus its id/name,
 * and the RPC validates against the same struct it serialized.
 *
 * The schema is deliberately closed and bounded. Everything a client can store
 * is a string id or one of the literals below; there is no free-form predicate
 * and no expression tree, so a saved view can never describe a query the board
 * cannot run, and can never become a way to read another workspace's rows.
 *
 * A filter dimension is `null` when it is not filtering. That is the whole
 * reason the document is null-shaped rather than filled with neutral values:
 * `null` translates to "emit no predicate" in the live query and to "no chip"
 * in the summary, so there is one spelling of "off" instead of an empty array,
 * an empty string, and a neutral literal that each reader has to know about.
 */

export const BOARD_STATUS_OPERATORS = ["isAnyOf", "isNot"] as const;

export type TBoardStatusOperator = (typeof BOARD_STATUS_OPERATORS)[number];

export const BoardStatusOperator = S.Literals(BOARD_STATUS_OPERATORS);

export const BOARD_TAG_OPERATORS = [
  "includeAllOf",
  "includeAnyOf",
  "excludeIfAnyOf",
  "excludeIfAllOf",
] as const;

export type TBoardTagOperator = (typeof BOARD_TAG_OPERATORS)[number];

export const BoardTagOperator = S.Literals(BOARD_TAG_OPERATORS);

export const BOARD_ORDER_FIELDS = [
  "createdAt",
  "title",
  "updatedAt",
  "upvoteCount",
] as const;

export type TBoardOrderField = (typeof BOARD_ORDER_FIELDS)[number];

export const BoardOrderField = S.Literals(BOARD_ORDER_FIELDS);

export const BOARD_ORDER_DIRECTIONS = ["asc", "desc"] as const;

export type TBoardOrderDirection = (typeof BOARD_ORDER_DIRECTIONS)[number];

export const BoardOrderDirection = S.Literals(BOARD_ORDER_DIRECTIONS);

/**
 * The longest search string a saved view may store.
 *
 * The board keeps the term as a local live-query predicate, so the bound is
 * about payload size rather than query cost: an imported 10 kB title search
 * would be re-parsed on every board render for no benefit.
 */
export const BOARD_VIEW_SEARCH_MAX_LENGTH = 200;

/**
 * How many ids one multi-select filter may carry.
 *
 * A workspace can hold more statuses and tags than this, but a saved view that
 * name-checks 20 labels is a list, not a filter; the cap keeps the jsonb row
 * small and the emitted `IN (...)` predicate list-bounded.
 */
export const BOARD_VIEW_FILTER_IDS_MAX = 20;

const FilterId = S.String.check(S.isMaxLength(64));

const FilterIds = S.Array(FilterId).check(
  S.isMaxLength(BOARD_VIEW_FILTER_IDS_MAX),
  // A present filter is never empty. `null` is how a dimension is off, so an
  // empty array would be a second spelling of the same state — and it would
  // mean "match nothing" to `inArray`, not "match everything".
  S.isMinLength(1)
);

/**
 * The status checklist and its operator.
 *
 * Filtering is by status *type*, not by status row id. A type is the
 * vocabulary that survives a workspace renaming, recolouring, or replacing its
 * status rows; an id would make a saved view point at a row that may no longer
 * exist. The column and the lane both carry the type for the same reason.
 */
export const BoardStatusFilter = S.Struct({
  operator: BoardStatusOperator,
  types: S.Array(PostStatusType).check(S.isMinLength(1)),
});

export type TBoardStatusFilter = S.Schema.Type<typeof BoardStatusFilter>;

/**
 * The label checklist and its operator.
 *
 * The four operators are one closed dimension rather than two booleans
 * (`include` × `all`): every combination is a shape the live query already
 * emits, and a wider product would need a join kind the board does not have.
 */
export const BoardTagFilter = S.Struct({
  operator: BoardTagOperator,
  tagIds: FilterIds,
});

export type TBoardTagFilter = S.Schema.Type<typeof BoardTagFilter>;

/**
 * Everything the chips row and the board's `where` clause read.
 *
 * Field names match the dashboard store verbatim, so `setActiveView` can hand a
 * saved view's filters to the store with no translation step — the one mapping
 * that would silently drop a filter added on one side later.
 */
export const BoardFilters = S.Struct({
  /**
   * Member ids a post must be assigned to. `null` means "anyone", including
   * unassigned posts, which is what the filter menu's cleared state means.
   */
  assigneeMemberIds: S.NullOr(FilterIds),
  /** The title term, or `null` when the search box is empty. */
  search: S.NullOr(S.String.check(S.isMaxLength(BOARD_VIEW_SEARCH_MAX_LENGTH))),
  status: S.NullOr(BoardStatusFilter),
  tag: S.NullOr(BoardTagFilter),
});

export type TBoardFilters = S.Schema.Type<typeof BoardFilters>;

/** Sort order, stored beside the filters because a view is a result set. */
export const BoardOrdering = S.Struct({
  direction: BoardOrderDirection,
  field: BoardOrderField,
});

export type TBoardOrdering = S.Schema.Type<typeof BoardOrdering>;

/**
 * How the board splits its result set into lanes.
 *
 * `status` is the default because the board is a kanban first: the grid's drop
 * targets and the list's add-post buttons are status lanes. The other fields
 * group the same result set without changing which posts it holds. `label` is
 * the one grouping that can put a post in more than one lane, because a post
 * may carry several labels; `none` renders one flat list.
 */
export const BOARD_GROUPING_FIELDS = [
  "status",
  "assignee",
  "board",
  "label",
  "none",
] as const;

export type TBoardGroupBy = (typeof BOARD_GROUPING_FIELDS)[number];

export const BoardGroupBy = S.Literals(BOARD_GROUPING_FIELDS);

export const BoardGrouping = S.Struct({
  field: BoardGroupBy,
});

export type TBoardGrouping = S.Schema.Type<typeof BoardGrouping>;

/** The grouping a board starts with. */
export const DEFAULT_BOARD_GROUPING: TBoardGrouping = { field: "status" };

/**
 * The document version.
 *
 * The row is persisted jsonb, so the shape can change only by naming a new
 * version and teaching `SavedView` to read both. Without it, a decoder has to
 * infer the writer's vintage from which keys are missing, which is exactly the
 * guess `grouping`'s old decoding default made.
 */
export const BOARD_QUERY_VERSION = 1;

export const BoardQuery = S.Struct({
  version: S.Literal(BOARD_QUERY_VERSION),
  filters: BoardFilters,
  grouping: BoardGrouping,
  ordering: BoardOrdering,
});

export type TBoardQuery = S.Schema.Type<typeof BoardQuery>;

/** A query that matches everything the board can show. */
export const emptyBoardQuery: TBoardQuery = {
  version: BOARD_QUERY_VERSION,
  filters: {
    assigneeMemberIds: null,
    search: null,
    status: null,
    tag: null,
  },
  grouping: { ...DEFAULT_BOARD_GROUPING },
  ordering: { direction: "desc", field: "createdAt" },
};

const sortIds = (ids: readonly string[]) => [...new Set(ids)].sort();

const canonicalStatus = (
  status: TBoardStatusFilter | null
): TBoardStatusFilter | null => {
  if (status === null || status.types.length === 0) {
    return null;
  }

  const selected = new Set(status.types);

  return {
    operator: status.operator,
    // Display order, not click order: the filter means a set, and two views
    // that select the same statuses in a different sequence must serialize to
    // the same document so their live-query keys agree.
    types: POST_STATUS_TYPES.filter((type) => selected.has(type)),
  };
};

const canonicalTag = (tag: TBoardTagFilter | null): TBoardTagFilter | null => {
  if (tag === null || tag.tagIds.length === 0) {
    return null;
  }

  return { operator: tag.operator, tagIds: sortIds(tag.tagIds) };
};

const canonicalAssignee = (
  ids: readonly string[] | null
): readonly string[] | null => {
  if (ids === null || ids.length === 0) {
    return null;
  }

  return sortIds(ids);
};

const canonicalSearch = (search: string | null) => {
  const trimmed = search?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
};

/** Empty and absent are the same state; a typed term is left as typed. */
const canonicalEmptySearch = (search: string | null) =>
  search === "" || search === null ? null : search;

/**
 * Canonicalizes the filters the board is holding.
 *
 * A typed search term is left exactly as typed: this runs on every store write,
 * including each keystroke, and trimming here would eat the space between two
 * words. Only the empty string collapses, because "cleared" and "never typed"
 * are one state; persistence trims through `normalizeBoardQuery` instead.
 *
 * Ids are sorted and de-duplicated so that the same selection is the same
 * value. TanStack DB hashes its `queryKey` with object keys sorted but arrays
 * kept in order, so `tagIds: [A, B]` and `[B, A]` would otherwise be two
 * different live queries that emit the same predicate.
 */
export const normalizeBoardFilters = (
  filters: TBoardFilters
): TBoardFilters => ({
  assigneeMemberIds: canonicalAssignee(filters.assigneeMemberIds),
  search: canonicalEmptySearch(filters.search),
  status: canonicalStatus(filters.status),
  tag: canonicalTag(filters.tag),
});

/**
 * The document as it is written to the row.
 *
 * Normalizing at the write boundary, rather than in the decoder, means the
 * stored bytes and the in-memory value are the same document: two clients that
 * build the same view in a different order store the same row, and a later
 * comparison of "which view is on screen" is a structural equality rather than
 * a filter-by-filter one.
 */
export const normalizeBoardQuery = (query: TBoardQuery): TBoardQuery => ({
  version: BOARD_QUERY_VERSION,
  filters: {
    ...normalizeBoardFilters(query.filters),
    search: canonicalSearch(query.filters.search),
  },
  grouping: { field: query.grouping.field },
  ordering: {
    direction: query.ordering.direction,
    field: query.ordering.field,
  },
});

/** Whether any filter would emit a predicate. */
export const hasActiveBoardFilters = (filters: TBoardFilters) =>
  (filters.search?.trim() ?? "") !== "" ||
  (filters.assigneeMemberIds?.length ?? 0) > 0 ||
  filters.status !== null ||
  filters.tag !== null;

/** The longest name a saved view may carry. */
export const SAVED_VIEW_NAME_MAX_LENGTH = 80;

/**
 * The longest description a saved view may carry.
 *
 * Shared with the client form so the field's counter and the persisted bound
 * are the same number; a description is a note to oneself, not a document.
 */
export const SAVED_VIEW_DESCRIPTION_MAX_LENGTH = 280;
