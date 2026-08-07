import { PostId, WorkspaceId } from "@feeblo/id";
import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import * as S from "effect/Schema";

export const PostReaction = S.Struct({
  id: S.String,
  postId: S.String,
  /** Denormalized post slug; unique per organization (post_organizationId_slug_uidx). */
  postSlug: S.String,
  organizationId: S.String,
  /** Null on public endpoints for reactors other than the session user. */
  userId: S.NullOr(S.String),
  memberId: S.Union([S.String, S.Null]),
  emoji: ReactionEmojiSchema,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TPostReaction = S.Schema.Type<typeof PostReaction>;

export const PostReactionList = S.Struct({
  organizationId: S.String,
  slug: S.String,
});

export type TPostReactionList = S.Schema.Type<typeof PostReactionList>;

export const PostReactionToggle = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  emoji: ReactionEmojiSchema,
});

export type TPostReactionToggle = S.Schema.Type<typeof PostReactionToggle>;
