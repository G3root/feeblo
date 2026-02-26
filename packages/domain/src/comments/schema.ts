import { Schema } from "effect";

export class Comment extends Schema.Class<Comment>("Comment")({
  id: Schema.String,
  content: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  organizationId: Schema.String,
  postId: Schema.String,
  userId: Schema.String,
  visibility: Schema.Literal("PUBLIC", "INTERNAL"),
  parentCommentId: Schema.Union(Schema.String, Schema.Null),
  memberId: Schema.Union(Schema.String, Schema.Null),
  user: Schema.Struct({
    name: Schema.String,
  }),
}) {}

export const CommentList = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TCommentList = Schema.Schema.Type<typeof CommentList>;

export const CommentCreate = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  postId: Schema.String,
  content: Schema.String,
  visibility: Schema.Literal("PUBLIC", "INTERNAL"),
  parentCommentId: Schema.Union(Schema.String, Schema.Null),
});

export type TCommentCreate = Schema.Schema.Type<typeof CommentCreate>;

export const CommentDelete = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TCommentDelete = Schema.Schema.Type<typeof CommentDelete>;

export const CommentUpdate = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  postId: Schema.String,
  content: Schema.String,
});

export type TCommentUpdate = Schema.Schema.Type<typeof CommentUpdate>;
