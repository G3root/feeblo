import {
  BoardQuery,
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
  query: BoardQuery,
});

export type TSavedViewCreate = S.Schema.Type<typeof SavedViewCreate>;

/**
 * Renaming and re-saving are the same write: "Save current view" over an
 * existing view sends its id, its name, and the query the board holds now.
 */
export const SavedViewUpdate = S.Struct({
  id: S.String,
  organizationId: WorkspaceId.schema,
  name: SavedViewName,
  query: BoardQuery,
});

export type TSavedViewUpdate = S.Schema.Type<typeof SavedViewUpdate>;

export const SavedViewDelete = S.Struct({
  id: S.String,
  organizationId: WorkspaceId.schema,
});

export type TSavedViewDelete = S.Schema.Type<typeof SavedViewDelete>;
