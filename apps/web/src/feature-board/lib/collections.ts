import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { Duration } from "effect";
import { fetchRpc } from "~/lib/runtime";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
  getUpvoteCollectionKey,
} from "../../dashboard/lib/reaction-keys";

type PublicCollectionScope = {
  organizationId: string;
  queryClient: QueryClient;
};

function getEqFilterValue(
  filters: ReadonlyArray<{
    field: ReadonlyArray<string | number>;
    operator: string;
    value?: unknown;
  }>,
  fieldName: string
) {
  for (const { field, operator, value } of filters) {
    if (operator === "eq" && field.join(".") === fieldName) {
      return value as string;
    }
  }

  return undefined;
}

export function createPublicCollections({
  organizationId,
  queryClient,
}: PublicCollectionScope) {
  const publicPostCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-post", organizationId],
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) =>
            rpc.PostListPublic({
              organizationId,
              boardId: null,
            }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedPost } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostUpdate({
            id: updatedPost.id,
            statusId: updatedPost.statusId,
            content: updatedPost.content,
            title: updatedPost.title,
            boardId: updatedPost.boardId,
            organizationId: updatedPost.organizationId,
          })
        );
      },
    })
  );

  const publicPostStatusCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-post-status", organizationId],

      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.PostStatusListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicChangelogCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-changelog", organizationId],
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.ChangelogListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicBoardCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-board", organizationId],

      refetchInterval: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.BoardListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicTagCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-tag", organizationId],
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.TagListPublic({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicPostTagCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-post-tag", organizationId],
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.PostTagListPublic({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicChangelogTagCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: ["public-changelog-tag", organizationId],

      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.ChangelogTagListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const publicCommentCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const postId = getEqFilterValue(parsed.filters, "postId");

        return postId
          ? ["public-comment", organizationId, `postId-${postId}`]
          : ["public-comment", organizationId];
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const postId = getEqFilterValue(parsed.filters, "postId");

        if (!postId) {
          return [];
        }

        try {
          const data = await fetchRpc(
            (rpc) =>
              rpc.CommentListPublic({
                organizationId,
                postId,
              }),
            { signal: ctx.signal }
          );

          return [...data];
        } catch {
          return [];
        }
      },
      queryClient,
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newComment } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentCreate({
            organizationId: newComment.organizationId,
            visibility: newComment.visibility,
            content: newComment.content,
            postId: newComment.postId,
            parentCommentId: newComment.parentCommentId,
            id: newComment.id,
          })
        );
      },
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedComment } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentUpdate({
            id: updatedComment.id,
            organizationId: updatedComment.organizationId,
            postId: updatedComment.postId,
            content: updatedComment.content,
          })
        );
      },
    })
  );

  const publicCommentReactionCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const postId = getEqFilterValue(parsed.filters, "postId");

        return postId
          ? ["public-comment-reaction", organizationId, `postId-${postId}`]
          : ["public-comment-reaction", organizationId];
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const postId = getEqFilterValue(parsed.filters, "postId");

        if (!postId) {
          return [];
        }

        try {
          const data = await fetchRpc(
            (rpc) => rpc.CommentReactionList({ organizationId, postId }),
            { signal: ctx.signal }
          );

          return [...data];
        } catch {
          return [];
        }
      },
      queryClient,
      getKey: getCommentReactionCollectionKey,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newCommentReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentReactionToggle({
            organizationId: newCommentReaction.organizationId,
            postId: newCommentReaction.postId,
            commentId: newCommentReaction.commentId,
            emoji: newCommentReaction.emoji,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedCommentReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentReactionToggle({
            organizationId: deletedCommentReaction.organizationId,
            postId: deletedCommentReaction.postId,
            commentId: deletedCommentReaction.commentId,
            emoji: deletedCommentReaction.emoji,
          })
        );
      },
    })
  );

  const publicUpvoteCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const postId = getEqFilterValue(parsed.filters, "postId");

        return postId
          ? ["public-upvote", organizationId, `postId-${postId}`]
          : ["public-upvote", organizationId];
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const postId = getEqFilterValue(parsed.filters, "postId");

        if (!postId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.UpvoteList({ organizationId, postId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      queryClient,
      getKey: getUpvoteCollectionKey,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteToggle({
            organizationId: newUpvote.organizationId,
            postId: newUpvote.postId,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteToggle({
            organizationId: deletedUpvote.organizationId,
            postId: deletedUpvote.postId,
          })
        );
      },
    })
  );

  const publicPostReactionCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const postId = getEqFilterValue(parsed.filters, "postId");

        return postId
          ? ["public-post-reaction", organizationId, `postId-${postId}`]
          : ["public-post-reaction", organizationId];
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const postId = getEqFilterValue(parsed.filters, "postId");

        if (!postId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.PostReactionList({ organizationId, postId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      queryClient,
      getKey: getPostReactionCollectionKey,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newPostReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostReactionToggle({
            organizationId: newPostReaction.organizationId,
            postId: newPostReaction.postId,
            emoji: newPostReaction.emoji,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedPostReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostReactionToggle({
            organizationId: deletedPostReaction.organizationId,
            postId: deletedPostReaction.postId,
            emoji: deletedPostReaction.emoji,
          })
        );
      },
    })
  );

  return {
    publicBoardCollection,
    publicChangelogCollection,
    publicChangelogTagCollection,
    publicCommentCollection,
    publicCommentReactionCollection,
    publicPostCollection,
    publicPostReactionCollection,
    publicPostStatusCollection,
    publicPostTagCollection,
    publicTagCollection,
    publicUpvoteCollection,
  };
}

export type PublicCollections = ReturnType<typeof createPublicCollections>;
