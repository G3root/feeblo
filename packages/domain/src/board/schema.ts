import { Schema } from "effect";

export class Board extends Schema.Class<Board>("Board")({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const BoardCreate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
});

export type TBoardCreate = Schema.Schema.Type<typeof BoardCreate>;

export const BoardUpdate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
});

export type TBoardUpdate = Schema.Schema.Type<typeof BoardUpdate>;
