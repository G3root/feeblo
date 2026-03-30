export function getPostReactionCollectionKey(reaction: {
  postId: string;
  userId: string;
  emoji: string;
}) {
  return `${reaction.postId}:${reaction.userId}:${reaction.emoji}`;
}

export function getCommentReactionCollectionKey(reaction: {
  commentId: string;
  userId: string;
  emoji: string;
}) {
  return `${reaction.commentId}:${reaction.userId}:${reaction.emoji}`;
}

export function getUpvoteCollectionKey(upvote: {
  postId: string;
  userId: string;
}) {
  return `${upvote.postId}:${upvote.userId}`;
}
