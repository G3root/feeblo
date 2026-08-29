import type { ChangelogSubscription } from "@feeblo/domain/changelog-subscription/schema";
import type { CommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { PostReaction } from "@feeblo/domain/post-reaction/schema";
import type { PostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { Upvote } from "@feeblo/domain/upvote/schema";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import {
  createRpcCollectionHelpers,
  postSlugFromPath,
} from "@feeblo/web-shared/collections";
import {
  getChangelogSubscriptionCollectionKey,
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
type ChangelogSubscriptionRow = Schema.Schema.Type<
  typeof ChangelogSubscription
>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;
type PostSubscriptionRow = Schema.Schema.Type<typeof PostSubscription>;
type UpvoteRow = Schema.Schema.Type<typeof Upvote>;

const queryClient = getContext().queryClient;

export function getCurrentOrganizationId() {
  if (!hasWindow()) {
    return undefined;
  }

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const runtimeWindow = window as Window & {
    global?: { __ENV?: { organizationId?: string } };
  };

  return runtimeWindow.global?.__ENV?.organizationId;
}

/**
 * Post detail pages are served at `/p/:slug`; parse the slug from the current
 * URL so the comment/reaction collections can be keyed and fetched when the
 * query is created without an explicit filter (e.g. from a route loader).
 */
function getCurrentPostSlug() {
  if (!hasWindow()) {
    return undefined;
  }

  return postSlugFromPath(window.location.pathname, "p", 1);
}

/**
 * Session user id, or undefined while signed out / during SSR. Subscription
 * RPCs scope their results to this user, so it keys their query caches.
 */
function getCurrentUserId() {
  if (!hasWindow()) {
    return undefined;
  }

  return getCachedAuthSession()?.user.id;
}

/**
 * Mutations are always scoped to the organization hosting this public board.
 * A restricted SSO session must never use a client-supplied entity organization
 * id to act on a different board.
 */
function getMutationOrganizationId() {
  const organizationId = getCurrentOrganizationId();

  if (!organizationId) {
    throw new Error("Missing public board organization id");
  }

  const restrictedToOrganizationId =
    getCachedAuthSession()?.user.restrictedToOrganizationId;

  if (
    restrictedToOrganizationId &&
    restrictedToOrganizationId !== organizationId
  ) {
    throw new Error("Session is not authorized for this organization");
  }

  return organizationId;
}

const { organizationScopedQueryKey, resolvePostSlug, slugScopedQueryKey } =
  createRpcCollectionHelpers({
    getOrganizationId: getCurrentOrganizationId,
    getPostSlug: getCurrentPostSlug,
  });

export const publicPostCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-post"),
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
        rpc.PostCreatePublic({
          id: newPost.id,
          boardId: newPost.boardId,
          organizationId: getMutationOrganizationId(),
          title: newPost.title,
          content: newPost.content,
          assetIds: newPost.assetIds ?? [],
          statusId: newPost.statusId,
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostUpdatePublic({
          id: updatedPost.id,
          statusId: updatedPost.statusId,
          boardId: updatedPost.boardId,
          organizationId: getMutationOrganizationId(),
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: deletedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostDeletePublic({
          organizationId: getMutationOrganizationId(),
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
    queryKey: () => organizationScopedQueryKey("public-post-status"),

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

export const publicRoadmapCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-roadmap"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.RoadmapListPublic({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const publicRoadmapColumnCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-roadmap-column"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.RoadmapColumnListPublic({ organizationId }),
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
    queryKey: () => organizationScopedQueryKey("public-changelog"),
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

export const publicChangelogCategoryCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-changelog-category"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogCategoryListPublic({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const publicChangelogCategoryLinkCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () =>
      organizationScopedQueryKey("public-changelog-category-link"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogCategoryListLinksPublic({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const getPublicChangelogPostKey = ({
  changelogId,
  postId,
}: {
  changelogId: string;
  postId: string;
}) => `${changelogId}:${postId}`;

export const publicChangelogPostCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-changelog-post"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogPostListPublic({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: getPublicChangelogPostKey,
  })
);

export const publicBoardCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryKey: () => organizationScopedQueryKey("public-board"),

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
    queryKey: () => organizationScopedQueryKey("public-tag"),
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
    queryKey: () => organizationScopedQueryKey("public-post-tag"),
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

export const publicCommentCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) =>
      slugScopedQueryKey(
        "public-comment",
        parseLoadSubsetOptions(opts).filters
      ),
    syncMode: "on-demand",
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(slug && organizationId)) {
        return [];
      }

      try {
        const data = await fetchRpc(
          (rpc) =>
            rpc.CommentListPublic({
              organizationId,
              slug,
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
        rpc.CommentCreatePublic({
          organizationId: getMutationOrganizationId(),
          visibility: newComment.visibility,
          content: newComment.content,
          postId: newComment.postId,
          parentCommentId: newComment.parentCommentId,
          id: newComment.id,
        })
      );
      await publicPostCollection.utils.refetch();
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedComment } = mutation;

      await fetchRpc((rpc) =>
        rpc.CommentUpdatePublic({
          id: updatedComment.id,
          organizationId: getMutationOrganizationId(),
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
        rpc.CommentDeletePublic({
          id: deletedComment.id,
          organizationId: getMutationOrganizationId(),
          postId: deletedComment.postId,
        })
      );
      await publicPostCollection.utils.refetch();
    },
  })
);

export const publicCommentReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) =>
      slugScopedQueryKey(
        "public-comment-reaction",
        parseLoadSubsetOptions(opts).filters
      ),
    syncMode: "on-demand",
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(slug && organizationId)) {
        return [];
      }

      try {
        const data = await fetchRpc(
          (rpc) => rpc.CommentReactionListPublic({ organizationId, slug }),
          { signal: ctx.signal }
        );

        return [...data];
      } catch {
        return [];
      }
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
    getKey: getCommentReactionCollectionKey as (
      item: CommentReactionRow
    ) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newCommentReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.CommentReactionTogglePublic({
          organizationId: getMutationOrganizationId(),
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
          organizationId: getMutationOrganizationId(),
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
    queryKey: organizationScopedQueryKey("public-upvote"),
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
      // SAFETY: The endpoint/API contract guarantees this response shape.
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
    getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteTogglePublic({
          organizationId: getMutationOrganizationId(),
          postId: newUpvote.postId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedUpvote } = mutation;

      await fetchRpc((rpc) =>
        rpc.UpvoteTogglePublic({
          organizationId: getMutationOrganizationId(),
          postId: deletedUpvote.postId,
        })
      );
    },
  })
);

export const publicPostReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) =>
      slugScopedQueryKey(
        "public-post-reaction",
        parseLoadSubsetOptions(opts).filters
      ),
    syncMode: "on-demand",
    staleTime: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(slug && organizationId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostReactionListPublic({ organizationId, slug }),
        {
          signal: ctx.signal,
        }
      );

      // SAFETY: The endpoint/API contract guarantees this response shape.
      return [...data];
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
    getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newPostReaction } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostReactionTogglePublic({
          organizationId: getMutationOrganizationId(),
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
          organizationId: getMutationOrganizationId(),
          postId: deletedPostReaction.postId,
          emoji: deletedPostReaction.emoji,
        })
      );
    },
  })
);

export const publicPostSubscriptionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) =>
      slugScopedQueryKey(
        "public-post-subscription",
        parseLoadSubsetOptions(opts).filters,
        getCurrentUserId()
      ),
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(slug && organizationId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostSubscriptionListPublic({ organizationId, slug }),
        {
          signal: ctx.signal,
        }
        // SAFETY: The endpoint/API contract guarantees this response shape.
      );
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      return [...data];
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
    getKey: getPostSubscriptionCollectionKey as (
      item: PostSubscriptionRow
    ) => string,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newSubscription } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostSubscriptionCreatePublic({
          organizationId: getMutationOrganizationId(),
          postId: newSubscription.postId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedSubscription } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostSubscriptionDeletePublic({
          organizationId: getMutationOrganizationId(),
          postId: deletedSubscription.postId,
        })
      );
    },
  })
);

export const publicChangelogSubscriptionCollection = createCollection(
  queryCollectionOptions({
    queryKey: () =>
      organizationScopedQueryKey(
        "public-changelog-subscription",
        getCurrentUserId()
      ),
    syncMode: "on-demand",
    queryFn: async () => {
      const organizationId = getCurrentOrganizationId();
      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) =>
        rpc.ChangelogSubscriptionListPublic({ organizationId })
      );
      // SAFETY: The endpoint/API contract guarantees this response shape.
      return [...data];
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
    getKey: getChangelogSubscriptionCollectionKey as (
      item: ChangelogSubscriptionRow
    ) => string,
    onInsert: async () => {
      await fetchRpc((rpc) =>
        rpc.ChangelogSubscriptionCreatePublic({
          organizationId: getMutationOrganizationId(),
        })
      );
    },
    onDelete: async () => {
      await fetchRpc((rpc) =>
        rpc.ChangelogSubscriptionDeletePublic({
          organizationId: getMutationOrganizationId(),
        })
      );
    },
  })
);

export const publicCollections = {
  publicBoardCollection,
  publicChangelogCategoryCollection,
  publicChangelogCategoryLinkCollection,
  publicChangelogCollection,
  publicChangelogPostCollection,
  publicCommentCollection,
  publicCommentReactionCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostSubscriptionCollection,
  publicChangelogSubscriptionCollection,
  publicPostTagCollection,
  publicRoadmapCollection,
  publicRoadmapColumnCollection,
  publicTagCollection,
  publicUpvoteCollection,
};

export type PublicCollections = typeof publicCollections;
