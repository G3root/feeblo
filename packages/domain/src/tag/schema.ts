import { PostId, TagId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Tag = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TTag = S.Schema.Type<typeof Tag>;

export const TagList = S.Struct({
  organizationId: S.String,
});

export type TTagList = S.Schema.Type<typeof TagList>;

export const TagCreate = S.Struct({
  id: TagId.schema,
  name: S.String,
  organizationId: WorkspaceId.schema,
});

export type TTagCreate = S.Schema.Type<typeof TagCreate>;

export const TagUpdate = S.Struct({
  id: TagId.schema,
  name: S.String,
  organizationId: WorkspaceId.schema,
});

export type TTagUpdate = S.Schema.Type<typeof TagUpdate>;

export const TagDelete = S.Struct({
  id: TagId.schema,
  organizationId: WorkspaceId.schema,
});

export type TTagDelete = S.Schema.Type<typeof TagDelete>;

export const PostTagAssignment = S.Struct({
  id: S.String,
  postId: S.String,
  tagId: S.String,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TPostTagAssignment = S.Schema.Type<typeof PostTagAssignment>;

export const PostTagList = S.Struct({
  organizationId: S.String,
});

export type TPostTagList = S.Schema.Type<typeof PostTagList>;

export const PostTagSet = S.Struct({
  postId: PostId.schema,
  organizationId: WorkspaceId.schema,
  tagIds: S.Array(TagId.schema),
});

export type TPostTagSet = S.Schema.Type<typeof PostTagSet>;
