import { Schema as S } from "effect";

export const PostReaction = S.Struct({
  id: S.String,
  postId: S.String,
  organizationId: S.String,
  userId: S.String,
  memberId: S.Union([S.String, S.Null]),
  emoji: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TPostReaction = S.Schema.Type<typeof PostReaction>;

export const PostReactionList = S.Struct({
  organizationId: S.String,
  postId: S.String,
});

export type TPostReactionList = S.Schema.Type<typeof PostReactionList>;

export const PostReactionToggle = S.Struct({
  organizationId: S.String,
  postId: S.String,
  emoji: S.String,
});

export type TPostReactionToggle = S.Schema.Type<typeof PostReactionToggle>;
