import { Schema } from "effect";

export class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  excerpt: Schema.String,
  upVotes: Schema.Number,
  statusId: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
  creatorMemberId: Schema.NullOr(Schema.String),
  creatorId: Schema.NullOr(Schema.String),
  lockedAt: Schema.NullOr(Schema.Date),
  archivedAt: Schema.NullOr(Schema.Date),
  mergedIntoPostId: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.Date),
  user: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    image: Schema.NullOr(Schema.String),
  }),
  hasUserUpVoted: Schema.Boolean,
}) {}

export type TPost = Schema.Schema.Type<typeof Post>;

export const PostList = Schema.Struct({
  boardId: Schema.Union(Schema.String, Schema.Null, Schema.Undefined),
  organizationId: Schema.String,
});

export type TPostList = Schema.Schema.Type<typeof PostList>;

export const PostIds = Schema.Array(Schema.String);

export const PostDelete = Schema.Struct({
  id: Schema.Union(Schema.String, PostIds),
  boardId: Schema.String,
  organizationId: Schema.String,
});

export type TPostDelete = Schema.Schema.Type<typeof PostDelete>;

export const PostUpdate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  statusId: Schema.String,
  boardId: Schema.String,
  organizationId: Schema.String,
});

export type TPostUpdate = Schema.Schema.Type<typeof PostUpdate>;

export const PostAdminUpdate = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  archived: Schema.optional(Schema.Boolean),
  locked: Schema.optional(Schema.Boolean),
});

export type TPostAdminUpdate = Schema.Schema.Type<typeof PostAdminUpdate>;

export const PostMerge = Schema.Struct({
  organizationId: Schema.String,
  sourcePostId: Schema.String,
  targetPostId: Schema.String,
});

export type TPostMerge = Schema.Schema.Type<typeof PostMerge>;

export const PostCreate = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  content: Schema.String,
  statusId: Schema.String,
  organizationId: Schema.String,
});

export type TPostCreate = Schema.Schema.Type<typeof PostCreate>;
