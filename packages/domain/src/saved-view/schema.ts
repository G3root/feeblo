import {
  BoardQuery,
  SAVED_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_VIEW_NAME_MAX_LENGTH,
} from "@feeblo/domain-contracts/board-query";
import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * The board query vocabulary is owned by `@feeblo/domain-contracts/board-query`
 * — the dashboard store, the board's live query, and this module all read the
 * same struct, so a filter added there is persisted and applied without a
 * translation step. Re-exported here so RPC consumers do not have to import
 * the contracts package directly for a saved view's payload type.
 */
export {
  BoardFilters,
  BoardQuery,
  BoardOrdering,
  type TBoardFilters,
  type TBoardQuery,
  type TBoardOrdering,
} from "@feeblo/domain-contracts/board-query";

const SavedViewName = S.Trim.pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(SAVED_VIEW_NAME_MAX_LENGTH))
);

/**
 * An optional note.
 *
 * The bound is checked here; the trim-and-null normalization happens in the
 * handler (`normalizeDescription`), because it describes what the *row* stores
 * rather than what the wire accepts, and a schema transform would have to be
 * mirrored in the client's encoder to keep the two agreeing about `""`.
 */
const SavedViewDescription = S.NullOr(
  S.String.check(S.isMaxLength(SAVED_VIEW_DESCRIPTION_MAX_LENGTH))
);

/**
 * A stored view as clients read it.
 *
 * `memberId` is the owner and is returned because the toolbar needs it to
 * decide whether to render edit/delete affordances; the handler never trusts a
 * payload's idea of it.
 */
export const SavedView = S.Struct({
  id: S.String,
  organizationId: S.String,
  memberId: S.String,
  /** Null for the organization-wide feedback list; set for one board. */
  boardId: S.NullOr(S.String),
  name: S.String,
  /** Null when the member left it blank. */
  description: S.NullOr(S.String),
  /** When true, only the owner can see the view. */
  isPrivate: S.Boolean,
  /** Position among this member's views on this surface, ascending. */
  orderIndex: S.Int,
  query: BoardQuery,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TSavedView = S.Schema.Type<typeof SavedView>;

/**
 * The views to show on one surface. The surface is named by `boardId` rather
 * than by a scope enum, so the same list call serves the board toolbar and the
 * organization-wide feedback list without a mode switch.
 */
export const SavedViewList = S.Struct({
  boardId: S.NullOr(S.String),
  organizationId: WorkspaceId.schema,
});

export type TSavedViewList = S.Schema.Type<typeof SavedViewList>;

/**
 * Ids are client-minted, like tags, statuses, and roadmap columns: the
 * toolbar inserts the optimistic row before the write lands, and it needs the
 * final id to key it.
 */
export const SavedViewCreate = S.Struct({
  id: S.String,
  organizationId: WorkspaceId.schema,
  boardId: S.NullOr(S.String),
  name: SavedViewName,
  description: SavedViewDescription,
  /** Omitted by clients that predate sharing; those views stay private. */
  isPrivate: S.optionalKey(S.Boolean),
  query: BoardQuery,
});

export type TSavedViewCreate = S.Schema.Type<typeof SavedViewCreate>;

/**
 * Renaming and re-saving are the same write: "Save current view" over an
 * existing view sends its id, the fields it changed, and the query the board
 * holds now.
 */
export const SavedViewUpdate = S.Struct({
  id: S.String,
  organizationId: WorkspaceId.schema,
  /**
   * Omitted keeps the stored name. A description, visibility, or query edit
   * sends no name, so a stale client cannot overwrite a rename saved since it
   * read the view.
   */
  name: S.optionalKey(SavedViewName),
  description: SavedViewDescription,
  /** Omitted keeps the row's current visibility. */
  isPrivate: S.optionalKey(S.Boolean),
  /**
   * Omitted keeps the stored query. A rename or description edit sends no
   * query, so a client holding a stale row cannot overwrite filters another
   * member has since saved.
   */
  query: S.optionalKey(BoardQuery),
});

export type TSavedViewUpdate = S.Schema.Type<typeof SavedViewUpdate>;

export const SavedViewDelete = S.Struct({
  id: S.String,
  organizationId: WorkspaceId.schema,
});

/**
 * The new order of one surface's views, named in full.
 *
 * A whole list rather than a move: positions are only meaningful relative to
 * each other, so a drag that lands between two views is one statement about
 * every view's position, and a caller cannot produce a half-applied order. The
 * write rejects a list that does not name exactly the member's views on that
 * surface, so a stale client cannot drop or adopt somebody else's row.
 */
export const SavedViewReorder = S.Struct({
  organizationId: WorkspaceId.schema,
  boardId: S.NullOr(S.String),
  orderedIds: S.Array(S.String).check(S.isMinLength(1)),
});

export type TSavedViewReorder = S.Schema.Type<typeof SavedViewReorder>;

export type TSavedViewDelete = S.Schema.Type<typeof SavedViewDelete>;
