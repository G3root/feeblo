import type { ReactionEmoji } from "@feeblo/utils/reaction";

export function getPostReactionCollectionKey(reaction: {
  postId: string;
  userId: string;
  emoji: ReactionEmoji;
}) {
  return `${reaction.postId}:${reaction.userId}:${reaction.emoji}`;
}

export function getCommentReactionCollectionKey(reaction: {
  commentId: string;
  userId: string;
  emoji: ReactionEmoji;
}) {
  return `${reaction.commentId}:${reaction.userId}:${reaction.emoji}`;
}

export function getUpvoteCollectionKey(upvote: {
  postId: string;
  userId: string;
}) {
  return `${upvote.postId}:${upvote.userId}`;
}

export function getPostSubscriptionCollectionKey(subscription: {
  postId: string;
  userId: string;
}) {
  return `${subscription.postId}:${subscription.userId}`;
}
