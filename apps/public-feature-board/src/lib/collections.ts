import type { CommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { PostReaction } from "@feeblo/domain/post-reaction/schema";
import type { PostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { Upvote } from "@feeblo/domain/upvote/schema";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
  getPostSubscriptionCollectionKey,
  getUpvoteCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import * as Duration from "effect/Duration";
import type * as Schema from "effect/Schema";

import { getContext } from "../integrations/tanstack-query/root-provider";

type CommentReactionRow = Schema.Schema.Type<typeof CommentReaction>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;
type PostSubscriptionRow = Schema.Schema.Type<typeof PostSubscription>;
type UpvoteRow = Schema.Schema.Type<typeof Upvote>;

const queryClient = getContext().queryClient;

function getCurrentOrganizationId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const runtimeWindow = window as Window & {
    global?: { __ENV?: { organizationId?: string } };
  };

  return runtimeWindow.global?.__ENV?.organizationId;
}

function getOrganizationScopedQueryKey(
  scope: string,
  ...parts: ReadonlyArray<string | undefined>
) {
  const organizationId = getCurrentOrganizationId();
  const key = organizationId ? [scope, organizationId] : [scope];

  for (const part of parts) {
    if (part) {
      key.push(part);
    }
  }

  return key;
}

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

export const publicPostCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-post"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostCreate({
          id: newPost.id,
          boardId: newPost.boardId,
          organizationId: newPost.organizationId,
          title: newPost.title,
          content: newPost.content,
          statusId: newPost.statusId,
        })
      );
    },
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
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: deletedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostDelete({
          organizationId: deletedPost.organizationId,
          boardId: deletedPost.boardId,
          id: deletedPost.id,
        })
      );
    },
  })
);

export const publicPostStatusCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-post-status"),

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicChangelogCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-changelog"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicBoardCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-board"),

    refetchInterval: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicTagCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-tag"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicPostTagCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-post-tag"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicChangelogTagCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => getOrganizationScopedQueryKey("public-changelog-tag"),

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

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

export const publicCommentCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("public-comment", "postId", postId)
        : getOrganizationScopedQueryKey("public-comment");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(postId && organizationId)) {
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
          visibility: updatedComment.visibility,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedComment } = mutation;

      await fetchRpc((rpc) =>
        rpc.CommentDelete({
          id: deletedComment.id,
          organizationId: deletedComment.organizationId,
          postId: deletedComment.postId,
        })
      );
    },
  })
);

export const publicCommentReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey(
            "public-comment-reaction",
            "postId",
            postId
          )
        : getOrganizationScopedQueryKey("public-comment-reaction");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(postId && organizationId)) {
        return [];
      }

      try {
        const data = await fetchRpc(
          (rpc) => rpc.CommentReactionListPublic({ organizationId, postId }),
          { signal: ctx.signal }
        );

        return [...data];
      } catch {
        return [];
      }
    },
    queryClient,
    getKey: getCommentReactionCollectionKey as (
      item: CommentReactionRow
    ) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newCommentReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.CommentReactionTogglePublic({
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
        rpc.CommentReactionTogglePublic({
          organizationId: deletedCommentReaction.organizationId,
          postId: deletedCommentReaction.postId,
          commentId: deletedCommentReaction.commentId,
          emoji: deletedCommentReaction.emoji,
        })
      );
    },
  })
);

export const publicUpvoteCollection = createCollection(
  queryCollectionOptions({
    queryKey: getOrganizationScopedQueryKey("public-upvote"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.UpvoteListPublic({ organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteTogglePublic({
          organizationId: newUpvote.organizationId,
          postId: newUpvote.postId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteTogglePublic({
          organizationId: deletedUpvote.organizationId,
          postId: deletedUpvote.postId,
        })
      );
    },
  })
);

export const publicPostReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey(
            "public-post-reaction",
            "postId",
            postId
          )
        : getOrganizationScopedQueryKey("public-post-reaction");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(postId && organizationId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostReactionListPublic({ organizationId, postId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newPostReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostReactionTogglePublic({
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
        rpc.PostReactionTogglePublic({
          organizationId: deletedPostReaction.organizationId,
          postId: deletedPostReaction.postId,
          emoji: deletedPostReaction.emoji,
        })
      );
    },
  })
);

export const publicPostSubscriptionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey(
            "public-post-subscription",
            "postId",
            postId
          )
        : getOrganizationScopedQueryKey("public-post-subscription");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(postId && organizationId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostSubscriptionList({ organizationId, postId }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    getKey: getPostSubscriptionCollectionKey as (
      item: PostSubscriptionRow
    ) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newSubscription } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostSubscriptionCreate({
          organizationId: newSubscription.organizationId,
          postId: newSubscription.postId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedSubscription } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostSubscriptionDelete({
          organizationId: deletedSubscription.organizationId,
          postId: deletedSubscription.postId,
        })
      );
    },
  })
);

export const publicCollections = {
  publicBoardCollection,
  publicChangelogCollection,
  publicChangelogTagCollection,
  publicCommentCollection,
  publicCommentReactionCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostSubscriptionCollection,
  publicPostTagCollection,
  publicTagCollection,
  publicUpvoteCollection,
};

export type PublicCollections = typeof publicCollections;
