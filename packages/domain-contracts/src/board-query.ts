import * as S from "effect/Schema";

import { PostStatusType } from "./post-status-type";

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
 */

/** The board's status preset, independent of the per-status checklist below. */
export const BOARD_POST_STATUS_FILTERS = ["all", "active", "backlog"] as const;

export type TBoardPostStatusFilter = (typeof BOARD_POST_STATUS_FILTERS)[number];

export const BoardPostStatusFilter = S.Literals(BOARD_POST_STATUS_FILTERS);

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
  S.isMaxLength(BOARD_VIEW_FILTER_IDS_MAX)
);

/**
 * Everything the chips row and the board's `where` clause read.
 *
 * Field names match the dashboard store verbatim, so `setActiveView` can hand a
 * saved view's filters to the store with no translation step — the one mapping
 * that would silently drop a filter added on one side later.
 */
export const BoardFilters = S.Struct({
  /**
   * Member ids a post must be assigned to. Empty means "anyone", including
   * unassigned posts, which is what the filter menu's cleared state means.
   */
  assigneeMemberIds: FilterIds,
  postStatus: BoardPostStatusFilter,
  search: S.String.check(S.isMaxLength(BOARD_VIEW_SEARCH_MAX_LENGTH)),
  statusOperator: BoardStatusOperator,
  statuses: S.Array(PostStatusType),
  tagOperator: BoardTagOperator,
  tagIds: FilterIds,
});

export type TBoardFilters = S.Schema.Type<typeof BoardFilters>;

/** Sort order, stored beside the filters because a view is a result set. */
export const BoardOrdering = S.Struct({
  direction: BoardOrderDirection,
  field: BoardOrderField,
});

export type TBoardOrdering = S.Schema.Type<typeof BoardOrdering>;

/**
 * A complete board query: what to show and in what order.
 *
 * Display mode (list vs grid) is deliberately absent — it is how one member
 * likes to read every view, not part of any one of them, and it already lives
 * in the board store on its own.
 */
export const BoardQuery = S.Struct({
  filters: BoardFilters,
  ordering: BoardOrdering,
});

export type TBoardQuery = S.Schema.Type<typeof BoardQuery>;

/** A query that matches everything the board can show. */
export const emptyBoardQuery: TBoardQuery = {
  filters: {
    assigneeMemberIds: [],
    postStatus: "all",
    search: "",
    statusOperator: "isAnyOf",
    statuses: [],
    tagOperator: "includeAllOf",
    tagIds: [],
  },
  ordering: { direction: "desc", field: "createdAt" },
};

/** The longest name a saved view may carry. */
export const SAVED_VIEW_NAME_MAX_LENGTH = 80;
