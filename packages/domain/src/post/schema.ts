import { BoardId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Post = S.Struct({
  id: S.String,
  boardId: S.String,
  title: S.String,
  slug: S.String,
  content: S.String,
  excerpt: S.String,
  statusId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
  organizationId: S.String,
  creatorMemberId: S.NullOr(S.String),
  creatorId: S.NullOr(S.String),
  lockedAt: S.NullOr(S.DateFromString),
  archivedAt: S.NullOr(S.DateFromString),
  mergedIntoPostId: S.NullOr(S.String),
  mergedAt: S.NullOr(S.DateFromString),
  user: S.Struct({
    name: S.NullOr(S.String),
    image: S.NullOr(S.String),
  }),
});

export type TPost = S.Schema.Type<typeof Post>;

export const PostList = S.Struct({
  boardId: S.Union([S.String, S.Null, S.Undefined]),
  organizationId: S.String,
});

export type TPostList = S.Schema.Type<typeof PostList>;

export const PostIds = S.Array(S.String);

export const PostDelete = S.Struct({
  id: S.Union([PostId.schema, S.Array(PostId.schema)]),
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostDelete = S.Schema.Type<typeof PostDelete>;

export const PostUpdate = S.Struct({
  id: PostId.schema,
  title: S.String,
  content: S.String,
  statusId: PostStatusId.schema,
  boardId: BoardId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostUpdate = S.Schema.Type<typeof PostUpdate>;

export const PostAdminUpdate = S.Struct({
  id: PostId.schema,
  organizationId: WorkspaceId.schema,
  archived: S.optional(S.Boolean),
  locked: S.optional(S.Boolean),
});

export type TPostAdminUpdate = S.Schema.Type<typeof PostAdminUpdate>;

export const PostMerge = S.Struct({
  organizationId: WorkspaceId.schema,
  sourcePostId: PostId.schema,
  targetPostId: PostId.schema,
});

export type TPostMerge = S.Schema.Type<typeof PostMerge>;

export const PostCreate = S.Struct({
  id: PostId.schema,
  boardId: BoardId.schema,
  title: S.String,
  content: S.String,
  statusId: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostCreate = S.Schema.Type<typeof PostCreate>;
