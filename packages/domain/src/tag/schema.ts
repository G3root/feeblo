import { Schema } from "effect";

export const TagType = Schema.Literal("FEEDBACK", "CHANGELOG");

export class Tag extends Schema.Class<Tag>("Tag")({
  id: Schema.String,
  name: Schema.String,
  type: TagType,
  organizationId: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export type TTag = Schema.Schema.Type<typeof Tag>;

export const TagList = Schema.Struct({
  organizationId: Schema.String,
});

export type TTagList = Schema.Schema.Type<typeof TagList>;

export const TagCreate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: TagType,
  organizationId: Schema.String,
});

export type TTagCreate = Schema.Schema.Type<typeof TagCreate>;

export const TagUpdate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: TagType,
  organizationId: Schema.String,
});

export type TTagUpdate = Schema.Schema.Type<typeof TagUpdate>;

export const TagDelete = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
});

export type TTagDelete = Schema.Schema.Type<typeof TagDelete>;

export const BoardTagSet = Schema.Struct({
  boardId: Schema.String,
  organizationId: Schema.String,
  tagIds: Schema.Array(Schema.String),
});

export type TBoardTagSet = Schema.Schema.Type<typeof BoardTagSet>;

export const ChangelogTagSet = Schema.Struct({
  changelogId: Schema.String,
  organizationId: Schema.String,
  tagIds: Schema.Array(Schema.String),
});

export type TChangelogTagSet = Schema.Schema.Type<typeof ChangelogTagSet>;
