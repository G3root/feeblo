import type { PublicApiVoteSource } from "./repository";
import type { TPublicApiVote } from "./schema";

/**
 * A vote as the vote endpoints return it.
 *
 * No context argument, like the comment mapper: nothing in a vote is derived
 * from the application URL or the workspace, and taking a context that is never
 * read would invite the next field to be composed from it without thinking
 * about what a machine key is allowed to see. The author is rebuilt field by
 * field from the source's nested shape so a column added to the row cannot flow
 * through.
 */
export const toPublicApiVote = (vote: PublicApiVoteSource): TPublicApiVote => ({
  id: vote.id,
  postId: vote.postId,
  author: {
    type: vote.author.type,
    displayName: vote.author.displayName,
    avatarUrl: vote.author.avatarUrl,
  },
  createdAt: vote.createdAt,
});
