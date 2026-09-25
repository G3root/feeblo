import type { CommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { TPostActivity } from "@feeblo/domain/post-activity/schema";
import type { PostReaction } from "@feeblo/domain/post-reaction/schema";
import type { PostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import type { Upvote } from "@feeblo/domain/upvote/schema";

/**
 * post-ui attaches a transient `author` to comment insert payloads so
 * on-behalf attribution rides the same onInsert path; it is not a persisted
 * column (see docs/on-behalf.md). Post on-behalf attribution flows via the
 * surface's `persistPost` input instead (slim list rows carry no body).
 */
type PostWithTransientAuthor = {
  author?: TPostCreateAuthor;
};
import { hasWindow } from "@feeblo/utils/runtime-kind";
import {
  createRpcCollectionHelpers,
  eqFilterValue,
  postSlugFromPath,
  refetchInBackground,
} from "@feeblo/web-shared/collections";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
  getPostSubscriptionCollectionKey,
  getUpvoteCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  BasicIndex,
  createCollection,
  parseLoadSubsetOptions,
} from "@tanstack/react-db";
import * as Duration from "effect/Duration";
import type * as Schema from "effect/Schema";

import { getContext } from "~/integrations/tanstack-query/root-provider";

import { fetchRpc } from "./runtime";

type CommentReactionRow = Schema.Schema.Type<typeof CommentReaction>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;
type PostSubscriptionRow = Schema.Schema.Type<typeof PostSubscription>;
type UpvoteRow = Schema.Schema.Type<typeof Upvote>;

const queryClient = getContext().queryClient;

function getCurrentOrganizationId() {
  if (!hasWindow()) {
    return undefined;
  }

  const organizationId = window.location.pathname
    .split("/")
    .find((segment) => segment.length > 0);

  return organizationId ? decodeURIComponent(organizationId) : undefined;
}

/**
 * Post detail pages live at `/:organizationId/.../post/:boardSlug/:postSlug`;
 * parse the post slug from the current URL so the comment/reaction collections
 * can be keyed and fetched when the query is created without an explicit
 * filter (e.g. from a route loader).
 */
function getCurrentPostSlug() {
  if (!hasWindow()) {
    return undefined;
  }

  return postSlugFromPath(window.location.pathname, "post", 2);
}

const { organizationScopedQueryKey, resolvePostSlug, slugScopedQueryKey } =
  createRpcCollectionHelpers({
    getOrganizationId: getCurrentOrganizationId,
    getPostSlug: getCurrentPostSlug,
  });

/**
 * Every collection carries an explicit `id`.
 *
 * `createCollection` generates a random UUID when the config has none, and
 * Workers forbid generating random values in global scope — which is where
 * this module evaluates, because the SSR bundle imports the whole route tree
 * (including the client-only dashboard routes). A missing `id` therefore
 * crashes every request in production with "Disallowed operation called
 * within global scope".
 */
export const postCollection = createCollection(
  queryCollectionOptions({
    id: "postCollection",
    queryKey: () => organizationScopedQueryKey("post"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const boardId: string | null = null;

      const data = await fetchRpc(
        (rpc) => rpc.PostList({ boardId, organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    // No `onInsert`: creation persists through the surface's `persistPost`
    // inside the shared form's optimistic action, so a bare insert fails
    // fast with `MissingInsertHandlerError` instead of persisting without
    // a body. Updates and deletes sync here as before.
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostUpdate({
          id: updatedPost.id,
          statusId: updatedPost.statusId,
          boardId: updatedPost.boardId,
          organizationId: updatedPost.organizationId,
        })
      );

      // The post row is the mutation target (already reconciled optimistically)
      // and the activity entry is derived from it: refresh the entry detached.
      refetchInBackground(postActivityCollection.utils.refetch());
    },
    onDelete: async ({ transaction }) => {
      const [firstMutation] = transaction.mutations;

      if (!firstMutation) {
        return;
      }

      const { organizationId } = firstMutation.original;
      // Deletes can arrive one at a time (row actions) or as one transaction
      // with many mutations (bulk selection). Group them into one bulk RPC
      // per board so both paths share the server call.
      const postIdsByBoardId = new Map<string, string[]>();

      for (const mutation of transaction.mutations) {
        const { original: deletedPost } = mutation;
        const postIds = postIdsByBoardId.get(deletedPost.boardId) ?? [];
        postIds.push(deletedPost.id);
        postIdsByBoardId.set(deletedPost.boardId, postIds);
      }

      // Settle every board's RPC before rejecting: `Promise.all` fail-fast
      // would strand a successful board's optimistic deletes behind the
      // failing one. The read-back below then runs in both outcomes, so the
      // rollback a rejection triggers reveals the reconciled rows instead of
      // resurrecting posts the server already deleted.
      const results = await Promise.allSettled(
        [...postIdsByBoardId.entries()].map(([boardId, postIds]) =>
          fetchRpc((rpc) =>
            rpc.PostDelete({
              id: postIds,
              boardId,
              organizationId,
            })
          )
        )
      );
      // Deleting a survivor also reverts its merged children server-side, so
      // the synced rows must be refreshed or the restored duplicates stay
      // hidden behind their stale `mergedIntoPostId`. This collection is the
      // mutation target, so the read-back is awaited.
      await postCollection.utils.refetch();
      // The delete-hint set is derived: refresh it detached so the delete
      // settles without waiting on a second round trip.
      refetchInBackground(deleteEligibilityCollection.utils.refetch());

      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        throw failure.reason;
      }
    },
  })
);

/**
 * Full-post detail collection backing post detail routes. The org-scoped
 * `postCollection` carries slim `PostListItem` rows (no `content`); this
 * slug-scoped, on-demand collection resolves the body through `PostGet`.
 * Detail routes preload + subscribe it and merge `content` over the list
 * row. Content edits apply here through `createOptimisticAction` (ambient
 * transaction, so no sync handlers by design); all other mutations stay on
 * the list collection.
 */
export const postDetailCollection = createCollection(
  queryCollectionOptions({
    id: "postDetailCollection",
    // Keyed by the explicit `slug` filter with a fallback to the route
    // slug, so detail subscribers (routes, content views) share one cache
    // entry per post regardless of where they subscribe from.
    queryKey: (opts) => {
      const filters = parseLoadSubsetOptions(opts).filters;
      const slug = eqFilterValue(filters, "slug") ?? resolvePostSlug(filters);
      return organizationScopedQueryKey("post-detail", slug);
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const filters = parseLoadSubsetOptions(
        ctx.meta?.loadSubsetOptions
      ).filters;
      const slug = eqFilterValue(filters, "slug") ?? resolvePostSlug(filters);

      if (!(organizationId && slug)) {
        return [];
      }

      const post = await fetchRpc(
        (rpc) => rpc.PostGet({ organizationId, slug }),
        { signal: ctx.signal }
      );
      return [post];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

postCollection.createIndex((row) => row.createdAt, {
  indexType: BasicIndex,
});

postCollection.createIndex((row) => row.statusId, {
  indexType: BasicIndex,
});

// Board queries filter by organization (and board) on every navigation;
// without these the live query scans the full overfetched collection.
postCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

postCollection.createIndex((row) => row.boardId, {
  indexType: BasicIndex,
});

export const postStatusCollection = createCollection(
  queryCollectionOptions({
    id: "postStatusCollection",
    queryKey: () => organizationScopedQueryKey("post-status"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostStatusList({ organizationId }),
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

postStatusCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

// Board, changelog, and merge queries join posts against status rows by id.
postStatusCollection.createIndex((row) => row.id, {
  indexType: BasicIndex,
});

export const changelogCollection = createCollection(
  queryCollectionOptions({
    id: "changelogCollection",
    queryKey: () => organizationScopedQueryKey("changelog"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogList({ organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedChangelog } = mutation;

      await fetchRpc((rpc) =>
        rpc.ChangelogUpdate({
          id: updatedChangelog.id,
          title: updatedChangelog.title,
          slug: updatedChangelog.slug,
          content: updatedChangelog.content,
          assetIds: updatedChangelog.assetIds ?? [],
          coverImage: updatedChangelog.coverImage ?? null,
          status: updatedChangelog.status,
          scheduledAt: updatedChangelog.scheduledAt,
          publishedAt: updatedChangelog.publishedAt,
          organizationId: updatedChangelog.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedChangelog } = mutation;

      await fetchRpc((rpc) =>
        rpc.ChangelogDelete({
          id: deletedChangelog.id,
          organizationId: deletedChangelog.organizationId,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newChangelog } = mutation;

      await fetchRpc((rpc) =>
        rpc.ChangelogCreate({
          id: newChangelog.id,
          title: newChangelog.title,
          slug: newChangelog.slug,
          content: newChangelog.content,
          assetIds: newChangelog.assetIds ?? [],
          coverImage: newChangelog.coverImage ?? null,
          status: newChangelog.status,
          scheduledAt: newChangelog.scheduledAt,
          publishedAt: newChangelog.publishedAt,
          organizationId: newChangelog.organizationId,
        })
      );
    },
  })
);

export const changelogCategoryLinkCollection = createCollection(
  queryCollectionOptions({
    id: "changelogCategoryLinkCollection",
    queryKey: () => organizationScopedQueryKey("changelog-category-link"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogCategoryListLinks({ organizationId }),
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

export const changelogCategoryCollection = createCollection(
  queryCollectionOptions({
    id: "changelogCategoryCollection",
    queryKey: () => organizationScopedQueryKey("changelog-category"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogCategoryList({ organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newCategory } = mutation;
      const iconType = newCategory.iconType;

      if (iconType !== "color") {
        throw new Error(
          "Unsupported changelog category icon type; only color is supported"
        );
      }

      await fetchRpc((rpc) =>
        rpc.ChangelogCategoryCreate({
          id: newCategory.id,
          name: newCategory.name,
          iconType,
          icon: newCategory.icon,
          organizationId: newCategory.organizationId,
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedCategory } = mutation;
      const iconType = updatedCategory.iconType;

      if (iconType !== "color") {
        throw new Error(
          "Unsupported changelog category icon type; only color is supported"
        );
      }

      await fetchRpc((rpc) =>
        rpc.ChangelogCategoryUpdate({
          id: updatedCategory.id,
          name: updatedCategory.name,
          iconType,
          icon: updatedCategory.icon,
          organizationId: updatedCategory.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedCategory } = mutation;

      await fetchRpc((rpc) =>
        rpc.ChangelogCategoryDelete({
          id: deletedCategory.id,
          organizationId: deletedCategory.organizationId,
        })
      );
    },
  })
);

export const getChangelogPostKey = ({
  changelogId,
  postId,
}: {
  changelogId: string;
  postId: string;
}) => `${changelogId}:${postId}`;

export const changelogPostCollection = createCollection(
  queryCollectionOptions({
    id: "changelogPostCollection",
    queryKey: () => organizationScopedQueryKey("changelog-post"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogPostList({ organizationId }),
        { signal: ctx.signal }
      );
      return [...data];
    },
    queryClient,
    getKey: getChangelogPostKey,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0];
      await fetchRpc((rpc) =>
        rpc.ChangelogPostCreate({
          changelogId: modified.changelogId,
          postId: modified.postId,
          organizationId: modified.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0];
      await fetchRpc((rpc) =>
        rpc.ChangelogPostDelete({
          changelogId: original.changelogId,
          postId: original.postId,
          organizationId: original.organizationId,
        })
      );
    },
  })
);

// Changelog completed-posts joins changelog entries against posts by post id.
changelogPostCollection.createIndex((row) => row.postId, {
  indexType: BasicIndex,
});

export const boardCollection = createCollection(
  queryCollectionOptions({
    id: "boardCollection",
    queryKey: () => organizationScopedQueryKey("board"),
    refetchInterval: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) => rpc.BoardList({ organizationId }), {
        signal: ctx.signal,
      });
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newBoard } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.BoardCreate({
            id: newBoard.id,
            name: newBoard.name,
            visibility: newBoard.visibility,
            organizationId: newBoard.organizationId,
          }),
        {}
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];

      const { original: deletedBoard } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.BoardDelete({
            id: deletedBoard.id,
            organizationId: deletedBoard.organizationId,
          }),
        {}
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedBoard } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.BoardUpdate({
            id: updatedBoard.id,
            name: updatedBoard.name,
            visibility: updatedBoard.visibility,
            organizationId: updatedBoard.organizationId,
          }),
        {}
      );
    },
  })
);

boardCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

// Post board queries join posts against boards by id.
boardCollection.createIndex((row) => row.id, {
  indexType: BasicIndex,
});

export const tagCollection = createCollection(
  queryCollectionOptions({
    id: "tagCollection",
    queryKey: () => organizationScopedQueryKey("tag"),

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) => rpc.TagList({ organizationId }), {
        signal: ctx.signal,
      });

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newTag } = mutation;

      await fetchRpc((rpc) =>
        rpc.TagCreate({
          id: newTag.id,
          name: newTag.name,
          organizationId: newTag.organizationId,
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedTag } = mutation;

      await fetchRpc((rpc) =>
        rpc.TagUpdate({
          id: updatedTag.id,
          name: updatedTag.name,
          organizationId: updatedTag.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedTag } = mutation;

      await fetchRpc((rpc) =>
        rpc.TagDelete({
          id: deletedTag.id,
          organizationId: deletedTag.organizationId,
        })
      );
    },
  })
);

tagCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

export const postTagCollection = createCollection(
  queryCollectionOptions({
    id: "postTagCollection",
    queryKey: () => organizationScopedQueryKey("post-tag"),

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostTagList({ organizationId }),
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

// Tag-filter queries hit all three axes (org scope, post join, tag match).
postTagCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

postTagCollection.createIndex((row) => row.postId, {
  indexType: BasicIndex,
});

postTagCollection.createIndex((row) => row.tagId, {
  indexType: BasicIndex,
});

export const membershipCollection = createCollection(
  queryCollectionOptions({
    id: "membershipCollection",
    queryKey: ["membership"],
    staleTime: Duration.toMillis(Duration.minutes(10)),
    queryFn: async (ctx) =>
      fetchRpc((rpc) => rpc.MembershipList(), { signal: ctx.signal }).then(
        (data) => [...data]
      ),
    queryClient,
    getKey: (item) => item.id,
  })
);

// Workspace details joins memberships against organizations by org id.
membershipCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

export const organizationCollection = createCollection(
  queryCollectionOptions({
    id: "organizationCollection",
    queryKey: ["organizations"],
    queryFn: async (ctx) => {
      const data = await fetchRpc((rpc) => rpc.OrganizationList(), {
        signal: ctx.signal,
      });

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedOrganization } = mutation;

      await fetchRpc((rpc) =>
        rpc.OrganizationUpdate({
          organizationId: updatedOrganization.id,
          name: updatedOrganization.name,
          logo: updatedOrganization.logo,
        })
      );
    },
  })
);

// Workspace details joins memberships against organizations by org id.
organizationCollection.createIndex((row) => row.id, {
  indexType: BasicIndex,
});

export const membersCollection = createCollection(
  queryCollectionOptions({
    id: "membersCollection",
    staleTime: Duration.toMillis(Duration.minutes(20)),
    queryKey: () => organizationScopedQueryKey("members"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.OrganizationMembersList({ organizationId }),
        { signal: ctx.signal }
      );
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedMember } = mutation;

      await fetchRpc((rpc) =>
        rpc.OrganizationRemoveMember({
          memberId: deletedMember.id,
          organizationId: deletedMember.organizationId,
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedMember } = mutation;

      await fetchRpc((rpc) =>
        rpc.OrganizationUpdateMemberRole({
          memberId: updatedMember.id,
          organizationId: updatedMember.organizationId,
          role: updatedMember.role,
        })
      );
    },
  })
);

export const invitationsCollection = createCollection(
  queryCollectionOptions({
    id: "invitationsCollection",
    queryKey: () => organizationScopedQueryKey("invitations"),

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.OrganizationInvitationsList({ organizationId }),
        { signal: ctx.signal }
      );
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedInvitation } = mutation;
      await fetchRpc((rpc) =>
        rpc.OrganizationCancelInvitation({
          invitationId: deletedInvitation.id,
          organizationId: deletedInvitation.organizationId,
        })
      );
    },
  })
);

export const commentCollection = createCollection(
  queryCollectionOptions({
    id: "commentCollection",
    queryKey: (opts) =>
      slugScopedQueryKey("comment", parseLoadSubsetOptions(opts).filters),
    syncMode: "on-demand",

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(organizationId && slug)) {
        return [];
      }

      try {
        const data = await fetchRpc(
          (rpc) => rpc.CommentList({ organizationId, slug }),
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

      // SAFETY: post-ui attaches the transient author payload declared on
      // PostWithTransientAuthor above.
      const author = (newComment as PostWithTransientAuthor).author;

      await fetchRpc(
        (rpc) =>
          rpc.CommentCreate({
            organizationId: newComment.organizationId,
            visibility: newComment.visibility,
            content: newComment.content,
            postId: newComment.postId,
            parentCommentId: newComment.parentCommentId,
            id: newComment.id,
            ...(author ? { author } : undefined),
            statusUpdateId: newComment.statusUpdateId ?? null,
          }),
        {}
      );

      // The comment row is the mutation target and is already reconciled
      // optimistically; the activity timeline, post rows, and delete-hint set
      // are derived from it, so they refresh detached rather than holding the
      // insert open for three round trips.
      refetchInBackground(
        postActivityCollection.utils.refetch(),
        postCollection.utils.refetch(),
        deleteEligibilityCollection.utils.refetch()
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedComment } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.CommentDelete({
            id: deletedComment.id,
            organizationId: deletedComment.organizationId,
            postId: deletedComment.postId,
          }),
        {}
      );

      // Same as the insert path: the optimistic delete already removed the
      // row, so the derived collections refresh detached.
      refetchInBackground(
        postActivityCollection.utils.refetch(),
        postCollection.utils.refetch(),
        deleteEligibilityCollection.utils.refetch()
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedComment } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.CommentUpdate({
            id: updatedComment.id,
            organizationId: updatedComment.organizationId,
            postId: updatedComment.postId,
            content: updatedComment.content,
            visibility: updatedComment.visibility,
          }),
        {}
      );

      // Only the activity entry is derived from an edit: refresh it detached.
      refetchInBackground(postActivityCollection.utils.refetch());
    },
  })
);

export const postActivityCollection = createCollection(
  queryCollectionOptions({
    id: "postActivityCollection",
    queryKey: (opts) => {
      const postId = eqFilterValue(
        parseLoadSubsetOptions(opts).filters,
        "postId"
      );

      return postId
        ? organizationScopedQueryKey("post-activity", "postId", postId)
        : organizationScopedQueryKey("post-activity");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const postId = eqFilterValue(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters,
        "postId"
      );

      if (!(organizationId && postId)) {
        return [];
      }

      const existingData =
        queryClient.getQueryData<readonly TPostActivity[]>(ctx.queryKey) ?? [];
      const since = existingData.reduce<Date | undefined>(
        (latest, activity) =>
          latest === undefined || activity.createdAt > latest
            ? activity.createdAt
            : latest,
        undefined
      );
      const changes = await fetchRpc(
        (rpc) =>
          rpc.PostActivityList({
            organizationId,
            postId,
            ...(since === undefined ? undefined : { since }),
          }),
        { signal: ctx.signal }
      );
      const merged = new Map(
        existingData.map((activity) => [activity.id, activity])
      );
      for (const activity of changes) {
        merged.set(activity.id, activity);
      }
      // Preserve the full merged history: the timeline renders every activity
      // and `since` only moves forward, so dropping entries would make that
      // history permanently unreachable (the backend offers no backfill for
      // older-than-window rows).
      const ordered = [...merged.values()].sort(
        (left, right) => +left.createdAt - +right.createdAt
      );
      return ordered;
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const commentReactionCollection = createCollection(
  queryCollectionOptions({
    id: "commentReactionCollection",
    queryKey: (opts) =>
      slugScopedQueryKey(
        "comment-reaction",
        parseLoadSubsetOptions(opts).filters
      ),
    syncMode: "on-demand",

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(organizationId && slug)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CommentReactionList({ organizationId, slug }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
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

export const upvoteCollection = createCollection(
  queryCollectionOptions({
    id: "upvoteCollection",
    // Lazy key: resolved at query time so navigation between organizations
    // never reuses another organization's cache entry (matches queryFn).
    queryKey: () => organizationScopedQueryKey("upvote"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) => rpc.UpvoteList({ organizationId }), {
        signal: ctx.signal,
      });
      return [...data];
    },
    // SAFETY: The endpoint/API contract guarantees this response shape.
    queryClient,
    // SAFETY: The endpoint/API contract guarantees this response shape.
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
      // The upvote row is the mutation target and holds the toggle
      // optimistically; vote counts derive from this collection client-side
      // (post rows carry no count), so the post rows and the delete-hint set
      // are derived refreshes that run detached.
      refetchInBackground(
        postCollection.utils.refetch(),
        deleteEligibilityCollection.utils.refetch()
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
      // Same as the insert path: derived refreshes run detached.
      refetchInBackground(
        postCollection.utils.refetch(),
        deleteEligibilityCollection.utils.refetch()
      );
    },
  })
);

// Upvote counts are derived per post on every board render; index both the
// org-scoped subscription filter and the per-post aggregation key.
upvoteCollection.createIndex((row) => row.organizationId, {
  indexType: BasicIndex,
});

upvoteCollection.createIndex((row) => row.postId, {
  indexType: BasicIndex,
});

/**
 * Creator delete hints for the whole organization, synced once. List rows
 * carry no delete hint (per-row probes on every list fetch); contributor
 * affordances derive from this small set client-side instead, and the
 * backend delete path re-validates. Presence of a row means eligible.
 * Refetch after engagement mutations (see the call sites below).
 */
export const deleteEligibilityCollection = createCollection(
  queryCollectionOptions({
    id: "deleteEligibilityCollection",
    queryKey: () => organizationScopedQueryKey("delete-eligibility"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const result = await fetchRpc(
        (rpc) => rpc.PostDeleteEligibilityList({ organizationId }),
        { signal: ctx.signal }
      );
      return result.eligibleIds.map((postId) => ({
        organizationId,
        postId,
      }));
    },
    queryClient,
    getKey: (item) => item.postId,
  })
);

deleteEligibilityCollection.createIndex((row) => row.postId, {
  indexType: BasicIndex,
});

export const postReactionCollection = createCollection(
  queryCollectionOptions({
    id: "postReactionCollection",
    queryKey: (opts) =>
      slugScopedQueryKey("post-reaction", parseLoadSubsetOptions(opts).filters),
    syncMode: "on-demand",

    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(organizationId && slug)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostReactionList({ organizationId, slug }),
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

export const siteCollection = createCollection(
  queryCollectionOptions({
    id: "siteCollection",
    queryKey: () => organizationScopedQueryKey("site"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) => rpc.SiteList({ organizationId }), {
        signal: ctx.signal,
      });
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    refetchInterval: Duration.toMillis(Duration.minutes(30)),
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedSite } = mutation;

      await fetchRpc((rpc) =>
        rpc.SiteUpdate({
          id: updatedSite.id,
          organizationId: updatedSite.organizationId,
          changelogVisibility: updatedSite.changelogVisibility,
          roadmapVisibility: updatedSite.roadmapVisibility,
          noIndex: updatedSite.noIndex,
          name: updatedSite.name,
        })
      );
    },
  })
);

export const workspacePlanCollection = createCollection(
  queryCollectionOptions({
    id: "workspacePlanCollection",
    queryKey: () => organizationScopedQueryKey("workspace-plan"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.WorkspacePlanGet({ organizationId }),
        {
          signal: ctx.signal,
        }
      );
      return [data];
    },
    queryClient,
    getKey: (item) => item.organizationId,
    staleTime: Number.POSITIVE_INFINITY,
  })
);

export const postSubscriptionCollection = createCollection(
  queryCollectionOptions({
    id: "postSubscriptionCollection",
    queryKey: (opts) =>
      slugScopedQueryKey(
        "post-subscription",
        parseLoadSubsetOptions(opts).filters
      ),
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const slug = resolvePostSlug(
        parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
      );

      if (!(organizationId && slug)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostSubscriptionList({ organizationId, slug }),
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
    getKey: getPostSubscriptionCollectionKey,
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

export const jwtSecretCollection = createCollection(
  queryCollectionOptions({
    id: "jwtSecretCollection",
    queryKey: () => organizationScopedQueryKey("jwt-secret"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.JwtSecretList({ organizationId }),
        { signal: ctx.signal }
      );
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const contactCollection = createCollection(
  queryCollectionOptions({
    id: "contactCollection",
    queryKey: () => organizationScopedQueryKey("contact"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ContactList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedContact } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactUpdate({
          id: updatedContact.id,
          organizationId: updatedContact.organizationId,
          externalId: updatedContact.externalId,
          email: updatedContact.email,
          name: updatedContact.name,
          phone: updatedContact.phone,
          avatar: updatedContact.avatar,
          companyId: updatedContact.companyId,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newContact } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactCreate({
          id: newContact.id,
          organizationId: newContact.organizationId,
          externalId: newContact.externalId,
          email: newContact.email,
          name: newContact.name,
          phone: newContact.phone,
          avatar: newContact.avatar,
          companyId: newContact.companyId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedContact } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactDelete({
          id: deletedContact.id,
          organizationId: deletedContact.organizationId,
        })
      );
    },
  })
);

export const companyCollection = createCollection(
  queryCollectionOptions({
    id: "companyCollection",
    queryKey: () => organizationScopedQueryKey("company"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CompanyList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedCompany } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyUpdate({
          id: updatedCompany.id,
          organizationId: updatedCompany.organizationId,
          externalId: updatedCompany.externalId,
          name: updatedCompany.name,
          avatar: updatedCompany.avatar,
          externalCreatedAt: updatedCompany.externalCreatedAt,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newCompany } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyCreate({
          id: newCompany.id,
          organizationId: newCompany.organizationId,
          externalId: newCompany.externalId,
          name: newCompany.name,
          avatar: newCompany.avatar,
          externalCreatedAt: newCompany.externalCreatedAt,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedCompany } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyDelete({
          id: deletedCompany.id,
          organizationId: deletedCompany.organizationId,
        })
      );
    },
  })
);

//Todo scope
export const contactAttributeDefinitionCollection = createCollection(
  queryCollectionOptions({
    id: "contactAttributeDefinitionCollection",
    queryKey: () => organizationScopedQueryKey("contact-attribute-definition"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ContactAttributeDefinitionList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactAttributeDefinitionUpdate({
          id: definition.id,
          name: definition.name,
          key: definition.key,
          description: definition.description,
          isRequired: definition.isRequired,
          organizationId: definition.organizationId,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactAttributeDefinitionCreate({
          id: definition.id,
          name: definition.name,
          key: definition.key,
          description: definition.description,
          type: definition.type,
          isRequired: definition.isRequired,
          organizationId: definition.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.ContactAttributeDefinitionDelete({
          id: definition.id,
          organizationId: definition.organizationId,
        })
      );
    },
  })
);

//Todo scope
export const companyAttributeDefinitionCollection = createCollection(
  queryCollectionOptions({
    id: "companyAttributeDefinitionCollection",
    queryKey: () => organizationScopedQueryKey("company-attribute-definition"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CompanyAttributeDefinitionList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyAttributeDefinitionUpdate({
          id: definition.id,
          name: definition.name,
          key: definition.key,
          description: definition.description,
          isRequired: definition.isRequired,
          organizationId: definition.organizationId,
        })
      );
    },
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyAttributeDefinitionCreate({
          id: definition.id,
          name: definition.name,
          key: definition.key,
          description: definition.description,
          type: definition.type,
          isRequired: definition.isRequired,
          organizationId: definition.organizationId,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: definition } = mutation;

      await fetchRpc((rpc) =>
        rpc.CompanyAttributeDefinitionDelete({
          id: definition.id,
          organizationId: definition.organizationId,
        })
      );
    },
  })
);

export const contactAttributeValueCollection = createCollection(
  queryCollectionOptions({
    id: "contactAttributeValueCollection",
    queryKey: () => organizationScopedQueryKey("contact-attribute-value"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ContactAttributeValueList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const companyAttributeValueCollection = createCollection(
  queryCollectionOptions({
    id: "companyAttributeValueCollection",
    queryKey: () => organizationScopedQueryKey("company-attribute-value"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CompanyAttributeValueList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const roadmapCollection = createCollection(
  queryCollectionOptions({
    id: "roadmapCollection",
    queryKey: () => organizationScopedQueryKey("roadmap"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.RoadmapList({ organizationId }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newRoadmap } = mutation;

      await fetchRpc((rpc) =>
        rpc.RoadmapCreate({
          id: newRoadmap.id,
          organizationId: newRoadmap.organizationId,
          name: newRoadmap.name,
          slug: newRoadmap.slug,
          description: newRoadmap.description,
          isPrimary: newRoadmap.isPrimary,
          mode: newRoadmap.mode,
          visibility: newRoadmap.visibility,
          filter: newRoadmap.filter,
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedRoadmap } = mutation;

      await fetchRpc((rpc) =>
        rpc.RoadmapUpdate({
          id: updatedRoadmap.id,
          organizationId: updatedRoadmap.organizationId,
          name: updatedRoadmap.name,
          slug: updatedRoadmap.slug,
          description: updatedRoadmap.description,
          isPrimary: updatedRoadmap.isPrimary,
          mode: updatedRoadmap.mode,
          visibility: updatedRoadmap.visibility,
          filter: updatedRoadmap.filter,
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedRoadmap } = mutation;

      await fetchRpc((rpc) =>
        rpc.RoadmapDelete({
          id: deletedRoadmap.id,
          organizationId: deletedRoadmap.organizationId,
        })
      );

      // Deleting the primary promotes a successor in the same server
      // transaction; read the rows back so the cached `isPrimary` flags match
      // the handoff instead of leaving the organization without a primary in
      // the client cache.
      await roadmapCollection.utils.refetch();
    },
  })
);

export const roadmapColumnCollection = createCollection(
  queryCollectionOptions({
    id: "roadmapColumnCollection",
    queryKey: () => organizationScopedQueryKey("roadmap-column"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.RoadmapColumnList({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newColumn } = mutation;
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        throw new Error("Missing organization id");
      }

      await fetchRpc((rpc) =>
        rpc.RoadmapColumnCreate({
          id: newColumn.id,
          roadmapId: newColumn.roadmapId,
          organizationId,
          name: newColumn.name,
          position: newColumn.position,
          config: { type: "status", statusId: newColumn.statusId },
        })
      );
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedColumn } = mutation;
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        throw new Error("Missing organization id");
      }

      await fetchRpc((rpc) =>
        rpc.RoadmapColumnUpdate({
          id: updatedColumn.id,
          roadmapId: updatedColumn.roadmapId,
          organizationId,
          name: updatedColumn.name,
          position: updatedColumn.position,
          config: { type: "status", statusId: updatedColumn.statusId },
        })
      );
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { original: deletedColumn } = mutation;
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        throw new Error("Missing organization id");
      }

      await fetchRpc((rpc) =>
        rpc.RoadmapColumnDelete({
          id: deletedColumn.id,
          roadmapId: deletedColumn.roadmapId,
          organizationId,
        })
      );
    },
  })
);

export const dashboardCollections = {
  boardCollection,
  changelogCategoryCollection,
  changelogCategoryLinkCollection,
  changelogCollection,
  changelogPostCollection,
  commentCollection,
  commentReactionCollection,
  companyCollection,
  deleteEligibilityCollection,
  companyAttributeDefinitionCollection,
  companyAttributeValueCollection,
  contactAttributeDefinitionCollection,
  contactAttributeValueCollection,
  contactCollection,
  invitationsCollection,
  jwtSecretCollection,
  membersCollection,
  membershipCollection,
  organizationCollection,
  postCollection,
  postDetailCollection,
  postActivityCollection,
  postReactionCollection,
  postStatusCollection,
  postSubscriptionCollection,
  roadmapCollection,
  roadmapColumnCollection,
  postTagCollection,
  siteCollection,
  tagCollection,
  upvoteCollection,
  workspacePlanCollection,
};

export type DashboardCollections = typeof dashboardCollections;
