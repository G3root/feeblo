import { PostId, WorkspaceId } from "@feeblo/id";
import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import { Schema as S } from "effect";

export const PostReaction = S.Struct({
  id: S.String,
  postId: S.String,
  organizationId: S.String,
  userId: S.String,
  memberId: S.Union([S.String, S.Null]),
  emoji: ReactionEmojiSchema,
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
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  emoji: ReactionEmojiSchema,
});

export type TPostReactionToggle = S.Schema.Type<typeof PostReactionToggle>;
