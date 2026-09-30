import type { PublicApiCommentSource } from "./repository";
import type { TPublicApiComment } from "./schema";

/**
 * A comment as the comment endpoints return it.
 *
 * No context argument, like the tag and company mappers: nothing in a comment
 * is derived from the application URL or the workspace, and taking a context
 * that is never read would invite the next field to be composed from it
 * without thinking about what a machine key is allowed to see. The author is
 * rebuilt field by field from the source's nested shape so a column added to
 * the row cannot flow through.
 */
export const toPublicApiComment = (
  comment: PublicApiCommentSource
): TPublicApiComment => ({
  id: comment.id,
  postId: comment.postId,
  content: comment.content,
  visibility: comment.visibility,
  parentCommentId: comment.parentCommentId,
  pinnedAt: comment.pinnedAt,
  author: {
    type: comment.author.type,
    displayName: comment.author.displayName,
    avatarUrl: comment.author.avatarUrl,
  },
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});
