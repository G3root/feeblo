import { Schema } from "effect";

export class CommentReaction extends Schema.Class<CommentReaction>("CommentReaction")({
  id: Schema.String,
  commentId: Schema.String,
  postId: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  memberId: Schema.Union(Schema.String, Schema.Null),
  emoji: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const CommentReactionList = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TCommentReactionList = Schema.Schema.Type<typeof CommentReactionList>;

export const CommentReactionToggle = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
  commentId: Schema.String,
  emoji: Schema.String,
});

export type TCommentReactionToggle = Schema.Schema.Type<typeof CommentReactionToggle>;
