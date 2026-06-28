import { BoardId, WorkspaceId } from "@feeblo/id";
import { Schema as S } from "effect";

export const Board = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  visibility: S.Literals(["PUBLIC", "PRIVATE"]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
});

export type TBoard = S.Schema.Type<typeof Board>;

export const BoardCreate = S.Struct({
  id: BoardId.schema,
  name: S.String,
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
  name: S.String,
  visibility: S.Literals(["PUBLIC", "PRIVATE"]),
  organizationId: WorkspaceId.schema,
});

export const BoardDelete = S.Struct({
  id: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TBoardUpdate = S.Schema.Type<typeof BoardUpdate>;
export type TBoardDelete = S.Schema.Type<typeof BoardDelete>;
