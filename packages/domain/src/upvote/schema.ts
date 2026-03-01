import { Schema } from "effect";

export class Upvote extends Schema.Class<Upvote>("Upvote")({
  id: Schema.String,
  postId: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  memberId: Schema.Union(Schema.String, Schema.Null),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const UpvoteList = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TUpvoteList = Schema.Schema.Type<typeof UpvoteList>;

export const UpvoteToggle = Schema.Struct({
  organizationId: Schema.String,
  postId: Schema.String,
});

export type TUpvoteToggle = Schema.Schema.Type<typeof UpvoteToggle>;
