import { Schema } from "effect";

export class PostReaction extends Schema.Class<PostReaction>("PostReaction")({
  id: Schema.String,
  postId: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  memberId: Schema.Union(Schema.String, Schema.Null),
  emoji: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const PostReactionList = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TPostReactionList = Schema.Schema.Type<typeof PostReactionList>;

export const PostReactionToggle = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
  emoji: Schema.String,
});

export type TPostReactionToggle = Schema.Schema.Type<typeof PostReactionToggle>;
