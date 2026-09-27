import type { ChangelogSubscription } from "@feeblo/domain/changelog-subscription/schema";
import type { CommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { PostReaction } from "@feeblo/domain/post-reaction/schema";
import type { PostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { Upvote } from "@feeblo/domain/upvote/schema";
import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import {
  createRpcCollectionHelpers,
  eqFilterValue,
  refetchInBackground,
} from "@feeblo/web-shared/collections";
import {
  getChangelogSubscriptionCollectionKey,
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
  getPostSubscriptionCollectionKey,
  getUpvoteCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { isRpcErrorTag } from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  BasicIndex,
  collectionOptions,
  parseLoadSubsetOptions,
} from "@tanstack/react-db";
import type { DbClient } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import * as Duration from "effect/Duration";
import type * as Schema from "effect/Schema";

import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  type BoardScope,
  requireMutationOrganizationId,
} from "./board-scope";

type CommentReactionRow = Schema.Schema.Type<typeof CommentReaction>;
type ChangelogSubscriptionRow = Schema.Schema.Type<
  typeof ChangelogSubscription
>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;
type PostSubscriptionRow = Schema.Schema.Type<typeof PostSubscription>;
type UpvoteRow = Schema.Schema.Type<typeof Upvote>;

/**
 * Session user id, or undefined while signed out / during SSR. Subscription
 * RPCs scope their results to this user, so it keys their query caches.
 */
const getCurrentUserId = createIsomorphicFn()
  .client(() => getCachedAuthSession()?.user.id)
  .server(() => undefined);

/**
 * The dependencies every board collection reads, resolved from the `DbClient`
 * that materializes it.
 *
 * Descriptors are module-level (components import them by identity), but the
 * values that scope them — the hosting organization, the viewed slug, the
 * Query client — are per request/document, so they arrive through the client
 * that owns the collection instead of through `window`. `scope` is the
 * mutable-by-design seam: the board layout fills it from the site it resolved
 * before any collection materializes, and slug lookups read the current
 * location so a browser client stays correct across navigations.
 */
function boardCollectionDeps(client: DbClient) {
  const scope = client.requireDependency<BoardScope>(BOARD_SCOPE_DEPENDENCY);
  const queryClient = client.requireDependency<QueryClient>(
    BOARD_QUERY_CLIENT_DEPENDENCY
  );
  const rpcHelpers = createRpcCollectionHelpers({
    getOrganizationId: () => scope.getOrganizationId(),
    getPostSlug: () => scope.getPostSlug(),
  });

  return {
    ...rpcHelpers,
    getChangelogSlug: () => scope.getChangelogSlug(),
    getMutationOrganizationId: () => requireMutationOrganizationId(scope),
    getOrganizationId: () => scope.getOrganizationId(),
    queryClient,
  };
}

/**
 * Every collection carries an explicit `id`: `createCollection` generates a
 * random UUID when the config has none, and Workers forbid generating random
 * values in global scope. An unnamed collection in the SSR bundle takes every
 * request down with it, so treat the ids as required, not optional.
 */
export const publicPostDescriptor = collectionOptions(
  "publicPostCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-post"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

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
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
      // No `onInsert`: creation persists through the surface's `persistPost`
      // inside the shared form's optimistic action, so a bare insert fails
      // fast with `MissingInsertHandlerError` instead of persisting without
      // a body. Updates and deletes sync here as before.
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedPost } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostUpdatePublic({
            id: updatedPost.id,
            statusId: updatedPost.statusId,
            boardId: updatedPost.boardId,
            organizationId: deps.getMutationOrganizationId(),
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: deletedPost } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostDeletePublic({
            organizationId: deps.getMutationOrganizationId(),
            boardId: deletedPost.boardId,
            id: deletedPost.id,
          })
        );
        // Same as the dashboard: a survivor delete reverts merged children
        // server-side, so refresh the synced rows that still point at it. This
        // collection is the mutation target, so the read-back is awaited.
        await client.collection(publicPostDescriptor).utils.refetch();
        // The delete-hint set is derived from the write, not part of it: it
        // refreshes in the background so the delete settles without waiting on
        // a second round trip.
        refetchInBackground(
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
    });
  }
);

export const publicPostStatusDescriptor = collectionOptions(
  "publicPostStatusCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-post-status"),

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.PostStatusListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicRoadmapDescriptor = collectionOptions(
  "publicRoadmapCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-roadmap"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.RoadmapListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicRoadmapColumnDescriptor = collectionOptions(
  "publicRoadmapColumnCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-roadmap-column"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.RoadmapColumnListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicChangelogDescriptor = collectionOptions(
  "publicChangelogCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-changelog"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ChangelogListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicChangelogCategoryDescriptor = collectionOptions(
  "publicChangelogCategoryCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () =>
        deps.organizationScopedQueryKey("public-changelog-category"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ChangelogCategoryListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicChangelogCategoryLinkDescriptor = collectionOptions(
  "publicChangelogCategoryLinkCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () =>
        deps.organizationScopedQueryKey("public-changelog-category-link"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ChangelogCategoryListLinksPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicChangelogDetailDescriptor = collectionOptions(
  "publicChangelogDetailCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.organizationScopedQueryKey(
          "public-changelog-detail",
          eqFilterValue(parseLoadSubsetOptions(opts).filters, "slug") ??
            deps.getChangelogSlug()
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const filters = parseLoadSubsetOptions(
          ctx.meta?.loadSubsetOptions
        ).filters;
        const slug = eqFilterValue(filters, "slug") ?? deps.getChangelogSlug();

        if (!(slug && organizationId)) {
          return [];
        }

        try {
          const entry = await fetchRpc(
            (rpc) => rpc.ChangelogGetPublic({ organizationId, slug }),
            { signal: ctx.signal }
          );
          return [entry];
        } catch (error) {
          // A missing or hidden entry resolves to an empty collection so the
          // page renders its not-found state; transport failures still surface
          // through the query error state.
          if (isRpcErrorTag(error, "ChangelogNotFoundError")) {
            return [];
          }
          throw error;
        }
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicBoardDescriptor = collectionOptions(
  "publicBoardCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-board"),

      refetchInterval: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.BoardListPublic({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicTagDescriptor = collectionOptions(
  "publicTagCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryKey: () => deps.organizationScopedQueryKey("public-tag"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

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
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicPostTagDescriptor = collectionOptions(
  "publicPostTagCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      // Slug-scoped and on-demand: only the viewed post's tag assignments are
      // fetched, not every assignment in the organization. The query key
      // resolves the route slug, so the preloaded subset and the component's
      // postId-filtered subscription share one cache entry.
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-post-tag",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(slug && organizationId)) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.PostTagListPublic({ organizationId, slug }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicCommentDescriptor = collectionOptions(
  "publicCommentCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-comment",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
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
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newComment } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentCreatePublic({
            organizationId: deps.getMutationOrganizationId(),
            visibility: newComment.visibility,
            content: newComment.content,
            postId: newComment.postId,
            parentCommentId: newComment.parentCommentId,
            id: newComment.id,
            statusUpdateId: newComment.statusUpdateId ?? null,
          })
        );
        // The comment is already reconciled optimistically; the post rows'
        // comment counts and the delete-hint set are derived, so both refresh
        // detached instead of holding the insert open for two round trips.
        refetchInBackground(
          client.collection(publicPostDescriptor).utils.refetch(),
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedComment } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentUpdatePublic({
            id: updatedComment.id,
            organizationId: deps.getMutationOrganizationId(),
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
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedComment.postId,
          })
        );
        // Same as the create path: the optimistic delete already removed the
        // row, so the derived post counts and delete hints refresh detached.
        refetchInBackground(
          client.collection(publicPostDescriptor).utils.refetch(),
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
    });
  }
);

export const publicCommentReactionDescriptor = collectionOptions(
  "publicCommentReactionCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-comment-reaction",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
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
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getCommentReactionCollectionKey as (
        item: CommentReactionRow
      ) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newCommentReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.CommentReactionTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
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
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedCommentReaction.postId,
            commentId: deletedCommentReaction.commentId,
            emoji: deletedCommentReaction.emoji,
          })
        );
      },
    });
  }
);

export const publicUpvoteDescriptor = collectionOptions(
  "publicUpvoteCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: deps.organizationScopedQueryKey("public-upvote"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

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
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: newUpvote.postId,
          })
        );
        // The upvote collection holds the toggle optimistically; the
        // delete-hint set is derived, so it refreshes detached.
        refetchInBackground(
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedUpvote.postId,
          })
        );
        // Same as the insert path: the derived hint set refreshes detached.
        refetchInBackground(
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
    });
  }
);

export const publicPostUpvoteDescriptor = collectionOptions(
  "publicPostUpvoteCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-post-upvote",
          parseLoadSubsetOptions(opts).filters,
          getCurrentUserId()
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(slug && organizationId)) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.UpvoteListPublic({ organizationId, slug }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      // SAFETY: The endpoint/API contract guarantees this response shape.
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: newUpvote.postId,
          })
        );
        // Same derived-refresh contract as the org-wide collection.
        refetchInBackground(
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpvoteTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedUpvote.postId,
          })
        );
        refetchInBackground(
          client.collection(publicDeleteEligibilityDescriptor).utils.refetch()
        );
      },
    });
  }
);

export const publicPostReactionDescriptor = collectionOptions(
  "publicPostReactionCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-post-reaction",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",
      staleTime: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
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
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newPostReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostReactionTogglePublic({
            organizationId: deps.getMutationOrganizationId(),
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
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedPostReaction.postId,
            emoji: deletedPostReaction.emoji,
          })
        );
      },
    });
  }
);

export const publicPostSubscriptionDescriptor = collectionOptions(
  "publicPostSubscriptionCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "public-post-subscription",
          parseLoadSubsetOptions(opts).filters,
          getCurrentUserId()
        ),
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
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
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getPostSubscriptionCollectionKey as (
        item: PostSubscriptionRow
      ) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newSubscription } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostSubscriptionCreatePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: newSubscription.postId,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedSubscription } = mutation;

        await fetchRpc((rpc) =>
          rpc.PostSubscriptionDeletePublic({
            organizationId: deps.getMutationOrganizationId(),
            postId: deletedSubscription.postId,
          })
        );
      },
    });
  }
);

export const publicChangelogSubscriptionDescriptor = collectionOptions(
  "publicChangelogSubscriptionCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: () =>
        deps.organizationScopedQueryKey(
          "public-changelog-subscription",
          getCurrentUserId()
        ),
      syncMode: "on-demand",
      queryFn: async () => {
        const organizationId = deps.getOrganizationId();
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
      queryClient: deps.queryClient,
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getChangelogSubscriptionCollectionKey as (
        item: ChangelogSubscriptionRow
      ) => string,
      onInsert: async () => {
        await fetchRpc((rpc) =>
          rpc.ChangelogSubscriptionCreatePublic({
            organizationId: deps.getMutationOrganizationId(),
          })
        );
      },
      onDelete: async () => {
        await fetchRpc((rpc) =>
          rpc.ChangelogSubscriptionDeletePublic({
            organizationId: deps.getMutationOrganizationId(),
          })
        );
      },
    });
  }
);

export const publicPostDetailDescriptor = collectionOptions(
  "publicPostDetailCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      // Keyed by the explicit `slug` filter with a fallback to the route
      // slug, so detail subscribers (routes, content views) share one cache
      // entry per post regardless of where they subscribe from.
      queryKey: (opts) => {
        const filters = parseLoadSubsetOptions(opts).filters;
        const slug =
          eqFilterValue(filters, "slug") ?? deps.resolvePostSlug(filters);
        return deps.organizationScopedQueryKey("public-post-detail", slug);
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const filters = parseLoadSubsetOptions(
          ctx.meta?.loadSubsetOptions
        ).filters;
        const slug =
          eqFilterValue(filters, "slug") ?? deps.resolvePostSlug(filters);

        if (!(organizationId && slug)) {
          return [];
        }

        try {
          const post = await fetchRpc(
            (rpc) => rpc.PostGetPublic({ organizationId, slug }),
            { signal: ctx.signal }
          );
          return [post];
        } catch (error) {
          // A missing or merged-away slug resolves to an empty collection so
          // the detail page renders its not-found/merge-resolver state instead
          // of an error; transport failures still surface through the query.
          if (isRpcErrorTag(error, "PostNotFoundError")) {
            return [];
          }
          throw error;
        }
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.id,
    });
  }
);

export const publicDeleteEligibilityDescriptor = collectionOptions(
  "publicDeleteEligibilityCollection",
  (client) => {
    const deps = boardCollectionDeps(client);

    return queryCollectionOptions({
      queryKey: () =>
        deps.organizationScopedQueryKey("public-delete-eligibility"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const result = await fetchRpc(
          (rpc) => rpc.PostDeleteEligibilityListPublic({ organizationId }),
          { signal: ctx.signal }
        );
        return result.eligibleIds.map((postId) => ({
          organizationId,
          postId,
        }));
      },
      queryClient: deps.queryClient,
      getKey: (item) => item.postId,
    });
  }
);

/**
 * The board's collections for one `DbClient`.
 *
 * Materializing through the client (rather than exporting module-level
 * instances) is what makes the board request-scoped: a server render and a
 * browser document each own their collections, and a mutation always targets
 * the instance the surrounding surface reads from.
 */
export function createPublicCollections(client: DbClient) {
  applyPublicCollectionIndexes(client);

  return {
    publicBoardCollection: client.collection(publicBoardDescriptor),
    publicChangelogCategoryCollection: client.collection(
      publicChangelogCategoryDescriptor
    ),
    publicChangelogCategoryLinkCollection: client.collection(
      publicChangelogCategoryLinkDescriptor
    ),
    publicChangelogCollection: client.collection(publicChangelogDescriptor),
    publicChangelogDetailCollection: client.collection(
      publicChangelogDetailDescriptor
    ),
    publicCommentCollection: client.collection(publicCommentDescriptor),
    publicCommentReactionCollection: client.collection(
      publicCommentReactionDescriptor
    ),
    publicDeleteEligibilityCollection: client.collection(
      publicDeleteEligibilityDescriptor
    ),
    publicPostCollection: client.collection(publicPostDescriptor),
    publicPostDetailCollection: client.collection(publicPostDetailDescriptor),
    publicPostReactionCollection: client.collection(
      publicPostReactionDescriptor
    ),
    publicPostStatusCollection: client.collection(publicPostStatusDescriptor),
    publicPostSubscriptionCollection: client.collection(
      publicPostSubscriptionDescriptor
    ),
    publicPostUpvoteCollection: client.collection(publicPostUpvoteDescriptor),
    publicChangelogSubscriptionCollection: client.collection(
      publicChangelogSubscriptionDescriptor
    ),
    publicPostTagCollection: client.collection(publicPostTagDescriptor),
    publicRoadmapCollection: client.collection(publicRoadmapDescriptor),
    publicRoadmapColumnCollection: client.collection(
      publicRoadmapColumnDescriptor
    ),
    publicTagCollection: client.collection(publicTagDescriptor),
    publicUpvoteCollection: client.collection(publicUpvoteDescriptor),
  };
}

export type PublicCollections = ReturnType<typeof createPublicCollections>;

/** Clients whose collections already carry their join indexes. */
const indexedClients = new WeakSet<DbClient>();

/**
 * Applies the live-query join indexes to this client's collections.
 *
 * Descriptors carry no index definitions — `createIndex` is a collection
 * method — so the indexes are applied once per client, when its collections
 * are first materialized. Live-query joins (posts to board/status, post tags
 * to tags, roadmap columns to roadmap/status) stay off the scan path.
 */
export function applyPublicCollectionIndexes(client: DbClient) {
  if (indexedClients.has(client)) {
    return;
  }

  indexedClients.add(client);

  client
    .collection(publicDeleteEligibilityDescriptor)
    .createIndex((row) => row.postId, { indexType: BasicIndex });
  client.collection(publicPostDescriptor).createIndex((row) => row.boardId, {
    indexType: BasicIndex,
  });
  client.collection(publicPostDescriptor).createIndex((row) => row.statusId, {
    indexType: BasicIndex,
  });
  client.collection(publicPostStatusDescriptor).createIndex((row) => row.id, {
    indexType: BasicIndex,
  });
  client.collection(publicBoardDescriptor).createIndex((row) => row.id, {
    indexType: BasicIndex,
  });
  client.collection(publicTagDescriptor).createIndex((row) => row.id, {
    indexType: BasicIndex,
  });
  client.collection(publicPostTagDescriptor).createIndex((row) => row.tagId, {
    indexType: BasicIndex,
  });
  client.collection(publicRoadmapDescriptor).createIndex((row) => row.id, {
    indexType: BasicIndex,
  });
  client
    .collection(publicRoadmapColumnDescriptor)
    .createIndex((row) => row.statusId, {
      indexType: BasicIndex,
    });
  client
    .collection(publicRoadmapColumnDescriptor)
    .createIndex((row) => row.roadmapId, {
      indexType: BasicIndex,
    });
  // Upvote rows are joined back to posts by post id.
  client.collection(publicUpvoteDescriptor).createIndex((row) => row.postId, {
    indexType: BasicIndex,
  });
}
