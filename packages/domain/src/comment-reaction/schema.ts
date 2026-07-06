import { CommentId, PostId, WorkspaceId } from "@feeblo/id";
import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import * as S from "effect/Schema";

export const CommentReaction = S.Struct({
  id: S.String,
  commentId: S.String,
  postId: S.String,
  organizationId: S.String,
  userId: S.String,
  memberId: S.Union([S.String, S.Null]),
  emoji: ReactionEmojiSchema,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TCommentReaction = S.Schema.Type<typeof CommentReaction>;

export const CommentReactionList = S.Struct({
  organizationId: S.String,
  postId: S.String,
});

export type TCommentReactionList = S.Schema.Type<typeof CommentReactionList>;

export const CommentReactionToggle = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  commentId: CommentId.schema,
  emoji: ReactionEmojiSchema,
});

export type TCommentReactionToggle = S.Schema.Type<
  typeof CommentReactionToggle
>;
