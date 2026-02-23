import { Schema } from "effect";

export class Board extends Schema.Class<Board>("Board")({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  visibility: Schema.Literal("PUBLIC", "PRIVATE"),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}
