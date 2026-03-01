import { Schema } from "effect";

const postStatus = Schema.Literal(
  "PAUSED",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED"
);

export class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  boardId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  upVotes: Schema.Number,
  status: postStatus,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
}) {}

export type TPost = Schema.Schema.Type<typeof Post>;

export const PostList = Schema.Struct({
  boardId: Schema.Union(Schema.String, Schema.Null, Schema.Undefined),
  organizationId: Schema.String,
});

export type TPostList = Schema.Schema.Type<typeof PostList>;

export const PostDelete = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  organizationId: Schema.String,
});

export type TPostDelete = Schema.Schema.Type<typeof PostDelete>;

export const PostUpdate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  status: postStatus,
  boardId: Schema.String,
  organizationId: Schema.String,
});

export type TPostUpdate = Schema.Schema.Type<typeof PostUpdate>;
