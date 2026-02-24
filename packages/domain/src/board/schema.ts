import { Schema } from "effect";

export class Board extends Schema.Class<Board>("Board")({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
}) {}

export const BoardCreate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
  organizationId: Schema.String,
});

export const BoardList = Schema.Struct({
  organizationId: Schema.String,
});

export type TBoardList = Schema.Schema.Type<typeof BoardList>;
export type TBoardCreate = Schema.Schema.Type<typeof BoardCreate>;

export const BoardUpdate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
  organizationId: Schema.String,
});

export const BoardDelete = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
});

export type TBoardUpdate = Schema.Schema.Type<typeof BoardUpdate>;
export type TBoardDelete = Schema.Schema.Type<typeof BoardDelete>;
