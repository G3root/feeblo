import { BoardId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Board = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  /**
   * A Tabler icon name from the dashboard's picker. Null is a board that has
   * never picked one; every surface resolves it to the client's default.
   */
  icon: S.NullOr(S.String),
  visibility: S.Literals(["PUBLIC", "PRIVATE"]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
});

export type TBoard = S.Schema.Type<typeof Board>;

export const BoardCreate = S.Struct({
  id: BoardId.schema,
  name: S.String,
  icon: S.optional(S.NullOr(S.String)),
  visibility: S.Literals(["PUBLIC", "PRIVATE"]),
  organizationId: WorkspaceId.schema,
});

export const BoardList = S.Struct({
  organizationId: S.String,
});

export type TBoardList = S.Schema.Type<typeof BoardList>;

export type TBoardCreate = S.Schema.Type<typeof BoardCreate>;

export const BoardUpdate = S.Struct({
  id: BoardId.schema,
  name: S.optional(S.String),
  icon: S.optional(S.NullOr(S.String)),
  visibility: S.optional(S.Literals(["PUBLIC", "PRIVATE"])),
  organizationId: WorkspaceId.schema,
});

export const BoardDelete = S.Struct({
  id: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TBoardUpdate = S.Schema.Type<typeof BoardUpdate>;

export type TBoardDelete = S.Schema.Type<typeof BoardDelete>;
