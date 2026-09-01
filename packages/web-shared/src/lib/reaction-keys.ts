import type { ReactionEmoji } from "@feeblo/utils/reaction";

/**
 * Public list endpoints redact other users' identity, so `userId` may be
 * null on every row except the current session user's own rows. These keys
 * fall back to the row `id` in that case so non-self rows stay unique and
 * stable in the client DB, while self rows keep the `postId:userId` key the
 * toggle logic depends on.
 */
export function getPostReactionCollectionKey(reaction: {
  id?: string;
  postId: string;
  userId: string | null;
  emoji: ReactionEmoji;
}) {
  return reaction.userId
    ? `${reaction.postId}:${reaction.userId}:${reaction.emoji}`
    : (reaction.id ?? `${reaction.postId}:${reaction.emoji}`);
}

export function getCommentReactionCollectionKey(reaction: {
  id?: string;
  commentId: string;
  userId: string | null;
  emoji: ReactionEmoji;
}) {
  return reaction.userId
    ? `${reaction.commentId}:${reaction.userId}:${reaction.emoji}`
    : (reaction.id ?? `${reaction.commentId}:${reaction.emoji}`);
}

export function getUpvoteCollectionKey(upvote: {
  id?: string;
  postId: string;
  userId: string | null;
}) {
  return upvote.userId
    ? `${upvote.postId}:${upvote.userId}`
    : (upvote.id ?? upvote.postId);
}

export function getPostSubscriptionCollectionKey(subscription: {
  id?: string;
  postId: string;
  userId: string | null;
}) {
  return subscription.userId
    ? `${subscription.postId}:${subscription.userId}`
    : (subscription.id ?? subscription.postId);
}

export function getChangelogSubscriptionCollectionKey(subscription: {
  id?: string;
  organizationId: string;
  userId: string | null;
}) {
  return subscription.userId
    ? `${subscription.organizationId}:${subscription.userId}`
    : (subscription.id ?? subscription.organizationId);
}
