import { Schema } from "effect";

export const Upvote = Schema.Struct({
  id: Schema.String,
  postId: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  memberId: Schema.Union(Schema.String, Schema.Null),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  user: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    image: Schema.NullOr(Schema.String),
  }),
});

export type TUpvote = Schema.Schema.Type<typeof Upvote>;

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
