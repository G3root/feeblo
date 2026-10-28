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
import {
  createRpcCollectionHelpers,
  eqFilterValue,
  refetchInBackground,
  type RpcCollectionHelpers,
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
  collectionOptions,
  DbClient,
  parseLoadSubsetOptions,
} from "@tanstack/react-db";
import type {
  CollectionOptions,
  NonSingleResult,
  UtilsRecord,
} from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import { getDbClient } from "@/lib/db-client";
import { getContext } from "~/integrations/tanstack-query/root-provider";

import {
  currentDashboardScope,
  type DashboardCollectionScope,
  dashboardScopeKey,
  organizationScopedCollectionId,
  slugScopedCollectionId,
} from "./collection-scope";
import { fetchRpc } from "./runtime";

type CommentReactionRow = Schema.Schema.Type<typeof CommentReaction>;
type PostReactionRow = Schema.Schema.Type<typeof PostReaction>;
type PostSubscriptionRow = Schema.Schema.Type<typeof PostSubscription>;
type UpvoteRow = Schema.Schema.Type<typeof Upvote>;

/**
 * The client the dashboard's collections materialize through.
 *
 * Shared with `getRouter()` so `useDbClient()` and the module-level
 * `dashboardCollections` accessor cannot end up with two clients (which would
 * mean two collections per descriptor, two syncs, and two sets of rows).
 */
function getBrowserDbClient(): DbClient {
  return getDbClient(() => getContext().queryClient);
}

/**
 * Everything one dashboard collection reads besides its own RPC: the client it
 * materializes through, the query client that owns its cache, and the identity
 * rules of the scope it belongs to.
 *
 * Resolved once per (client, scope) by `createDashboardCollections`, so a
 * descriptor is a pure function of its deps. That is what lets a test build a
 * `DbClient`, hand it a scope, and read every collection's id and query key
 * without a router, a `window`, or the app's React tree.
 *
 * The scope is a *value* rather than a mutable dependency the way the public
 * board's `BoardScope` is: a board client is built per request or per document
 * and fills its scope after it exists, while the dashboard's browser client
 * outlives a navigation between workspaces, so a descriptor has to capture the
 * scope it was created for. That capture is what keeps one workspace's rows out
 * of another's collection, and `collection-scope.test.ts` pins it at the id
 * level.
 */
type DashboardCollectionDeps = {
  readonly client: DbClient;
  readonly queryClient: QueryClient;
  /** Descriptor id for an organization-scoped collection. */
  readonly collectionId: (name: string) => string;
  /** Descriptor id for an organization-and-post-scoped collection. */
  readonly slugCollectionId: (name: string) => string;
  readonly getOrganizationId: () => string | undefined;
  readonly organizationScopedQueryKey: RpcCollectionHelpers["organizationScopedQueryKey"];
  readonly resolvePostSlug: RpcCollectionHelpers["resolvePostSlug"];
  readonly slugScopedQueryKey: RpcCollectionHelpers["slugScopedQueryKey"];
};

/**
 * Binds the shared collection helpers to one dashboard scope.
 *
 * The key and slug rules are `@feeblo/web-shared/collections`', the same ones
 * the public board's `boardCollectionDeps` binds; the dashboard used to carry
 * its own copies of all three, which is how the two surfaces were able to drift
 * on the shape of a query key.
 */
function dashboardCollectionDeps(
  client: DbClient,
  scope: DashboardCollectionScope
): DashboardCollectionDeps {
  const helpers = createRpcCollectionHelpers({
    getOrganizationId: () => scope.organizationId,
    getPostSlug: () => scope.postSlug,
  });

  return {
    client,
    collectionId: (name) => organizationScopedCollectionId(name, scope),
    getOrganizationId: () => scope.organizationId,
    // Wrapped rather than referenced: the helpers are plain closures, but a
    // method-shaped type reads as an unbound method to the type-aware linter.
    organizationScopedQueryKey: (name, ...parts) =>
      helpers.organizationScopedQueryKey(name, ...parts),
    queryClient: client.requireDependency<QueryClient>("queryClient"),
    resolvePostSlug: (filters) => helpers.resolvePostSlug(filters),
    slugCollectionId: (name) => slugScopedCollectionId(name, scope),
    slugScopedQueryKey: (name, filters, ...parts) =>
      helpers.slugScopedQueryKey(name, filters, ...parts),
  };
}

function postCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("postCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("post"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const boardId: string | null = null;

        const data = await fetchRpc(
          (rpc) => rpc.ListPosts({ boardId, organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      // No `onInsert`: creation persists through the surface's `persistPost`
      // inside the shared form's optimistic action, so a bare insert fails
      // fast with `MissingInsertHandlerError` instead of persisting without
      // a body. Updates and deletes sync here as before.
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedPost } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdatePost({
            id: updatedPost.id,
            statusId: updatedPost.statusId,
            boardId: updatedPost.boardId,
            organizationId: updatedPost.organizationId,
          })
        );

        // The post row is the mutation target (already reconciled optimistically)
        // and the activity entry is derived from it: refresh the entry detached.
        refetchInBackground(
          deps.client.collection(postActivityCollection(deps)).utils.refetch()
        );
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
              rpc.DeletePost({
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
        await deps.client.collection(postCollection(deps)).utils.refetch();
        // The delete-hint set is derived: refresh it detached so the delete
        // settles without waiting on a second round trip.
        refetchInBackground(
          deps.client
            .collection(deleteEligibilityCollection(deps))
            .utils.refetch()
        );

        const failure = results.find((result) => result.status === "rejected");
        if (failure) {
          throw failure.reason;
        }
      },
    })
  );
}

/**
 * Full-post detail collection backing post detail routes. The org-scoped
 * `postCollection` carries slim `PostListItem` rows (no `content`); this
 * slug-scoped, on-demand collection resolves the body through `GetPost`.
 * Detail routes preload + subscribe it and merge `content` over the list
 * row. Content edits apply here through `createOptimisticAction` (ambient
 * transaction, so no sync handlers by design); all other mutations stay on
 * the list collection.
 */
function postDetailCollection(deps: DashboardCollectionDeps) {
  const id = deps.slugCollectionId("postDetailCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      // Keyed by the explicit `slug` filter with a fallback to the route
      // slug, so detail subscribers (routes, content views) share one cache
      // entry per post regardless of where they subscribe from.
      queryKey: (opts) => {
        const filters = parseLoadSubsetOptions(opts).filters;
        const slug =
          eqFilterValue(filters, "slug") ?? deps.resolvePostSlug(filters);
        return deps.organizationScopedQueryKey("post-detail", slug);
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

        const post = await fetchRpc(
          (rpc) =>
            rpc
              .GetPost({ organizationId, slug })
              // A missing slug is an empty lookup, not a failed one: the live
              // query resolves to no row and the route renders its "Post not
              // found" state. Without this the not-found error rejects the
              // preload, and a stale or mistyped post URL lands on the route's
              // error boundary instead of that state.
              .pipe(
                Effect.catchTag("PostNotFoundError", () => Effect.succeed(null))
              ),
          { signal: ctx.signal }
        );
        return post === null ? [] : [post];
      },
      getKey: (item) => item.id,
    })
  );
}

function postStatusCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("postStatusCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("post-status"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListPostStatuses({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newStatus } = mutation;
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          throw new Error("Missing organization id");
        }

        await fetchRpc((rpc) =>
          rpc.CreatePostStatus({
            id: newStatus.id,
            organizationId,
            type: newStatus.type,
            label: newStatus.label,
            color: newStatus.color ?? null,
            orderIndex: newStatus.orderIndex,
          })
        );
      },
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedStatus } = mutation;
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          throw new Error("Missing organization id");
        }

        await fetchRpc((rpc) =>
          rpc.UpdatePostStatus({
            id: updatedStatus.id,
            organizationId,
            type: updatedStatus.type,
            label: updatedStatus.label,
            color: updatedStatus.color ?? null,
          })
        );
      },
    })
  );
}

/**
 * The changelog write endpoints accept only the statuses a write may set:
 * `scheduled` is a future feature (the scheduler does not exist), so a row
 * read back as scheduled — filed before scheduling was disabled — is saved as
 * the draft it effectively is. The wire type is the source of truth; this
 * keeps an old row editable without a second request.
 */
const toWritableChangelogStatus = (
  status: "draft" | "published" | "scheduled"
): "draft" | "published" => (status === "scheduled" ? "draft" : status);

function changelogCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("changelogCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("changelog"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListChangelogs({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedChangelog } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateChangelog({
            id: updatedChangelog.id,
            title: updatedChangelog.title,
            slug: updatedChangelog.slug,
            content: updatedChangelog.content,
            assetIds: updatedChangelog.assetIds ?? [],
            coverImage: updatedChangelog.coverImage ?? null,
            status: toWritableChangelogStatus(updatedChangelog.status),
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
          rpc.DeleteChangelog({
            id: deletedChangelog.id,
            organizationId: deletedChangelog.organizationId,
          })
        );
      },
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newChangelog } = mutation;

        await fetchRpc((rpc) =>
          rpc.CreateChangelog({
            id: newChangelog.id,
            title: newChangelog.title,
            slug: newChangelog.slug,
            content: newChangelog.content,
            assetIds: newChangelog.assetIds ?? [],
            coverImage: newChangelog.coverImage ?? null,
            status: toWritableChangelogStatus(newChangelog.status),
            scheduledAt: newChangelog.scheduledAt,
            publishedAt: newChangelog.publishedAt,
            organizationId: newChangelog.organizationId,
          })
        );
      },
    })
  );
}

function changelogCategoryLinkCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("changelogCategoryLinkCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () =>
        deps.organizationScopedQueryKey("changelog-category-link"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListChangelogCategoryLinks({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      getKey: (item) => item.id,
    })
  );
}

function changelogCategoryCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("changelogCategoryCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("changelog-category"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListChangelogCategories({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
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
          rpc.CreateChangelogCategory({
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
          rpc.UpdateChangelogCategory({
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
          rpc.DeleteChangelogCategory({
            id: deletedCategory.id,
            organizationId: deletedCategory.organizationId,
          })
        );
      },
    })
  );
}

export const getChangelogPostKey = ({
  changelogId,
  postId,
}: {
  changelogId: string;
  postId: string;
}) => `${changelogId}:${postId}`;

function changelogPostCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("changelogPostCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("changelog-post"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListChangelogPosts({ organizationId }),
          { signal: ctx.signal }
        );
        return [...data];
      },
      getKey: getChangelogPostKey,
      onInsert: async ({ transaction }) => {
        const { modified } = transaction.mutations[0];
        await fetchRpc((rpc) =>
          rpc.CreateChangelogPost({
            changelogId: modified.changelogId,
            postId: modified.postId,
            organizationId: modified.organizationId,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const { original } = transaction.mutations[0];
        await fetchRpc((rpc) =>
          rpc.DeleteChangelogPost({
            changelogId: original.changelogId,
            postId: original.postId,
            organizationId: original.organizationId,
          })
        );
      },
    })
  );
}

function boardCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("boardCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("board"),
      refetchInterval: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListBoards({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newBoard } = mutation;

        await fetchRpc(
          (rpc) =>
            rpc.CreateBoard({
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
            rpc.DeleteBoard({
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
            rpc.UpdateBoard({
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
}

function tagCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("tagCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("tag"),

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc((rpc) => rpc.ListTags({ organizationId }), {
          signal: ctx.signal,
        });

        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newTag } = mutation;

        await fetchRpc((rpc) =>
          rpc.CreateTag({
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
          rpc.UpdateTag({
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
          rpc.DeleteTag({
            id: deletedTag.id,
            organizationId: deletedTag.organizationId,
          })
        );
      },
    })
  );
}

function postTagCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("postTagCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("post-tag"),

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListPostTags({ organizationId }),
          {
            signal: ctx.signal,
          }
        );

        return [...data];
      },
      getKey: (item) => item.id,
    })
  );
}

function membershipCollection(deps: DashboardCollectionDeps) {
  const id = "membershipCollection";

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: ["membership"],
      staleTime: Duration.toMillis(Duration.minutes(10)),
      queryFn: async (ctx) =>
        fetchRpc((rpc) => rpc.ListMemberships(), { signal: ctx.signal }).then(
          (data) => [...data]
        ),
      getKey: (item) => item.id,
    })
  );
}

function organizationCollection(deps: DashboardCollectionDeps) {
  const id = "organizationCollection";

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: ["organizations"],
      queryFn: async (ctx) => {
        const data = await fetchRpc((rpc) => rpc.ListOrganizations(), {
          signal: ctx.signal,
        });

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedOrganization } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateOrganization({
            organizationId: updatedOrganization.id,
            name: updatedOrganization.name,
            logo: updatedOrganization.logo,
          })
        );
      },
    })
  );
}

function membersCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("membersCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      staleTime: Duration.toMillis(Duration.minutes(20)),
      queryKey: () => deps.organizationScopedQueryKey("members"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListOrganizationMembers({ organizationId }),
          { signal: ctx.signal }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedMember } = mutation;

        await fetchRpc((rpc) =>
          rpc.RemoveOrganizationMember({
            memberId: deletedMember.id,
            organizationId: deletedMember.organizationId,
          })
        );
      },
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedMember } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateOrganizationMemberRole({
            memberId: updatedMember.id,
            organizationId: updatedMember.organizationId,
            role: updatedMember.role,
          })
        );
      },
    })
  );
}

function invitationsCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("invitationsCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("invitations"),

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListOrganizationInvitations({ organizationId }),
          { signal: ctx.signal }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedInvitation } = mutation;
        await fetchRpc((rpc) =>
          rpc.CancelOrganizationInvitation({
            invitationId: deletedInvitation.id,
            organizationId: deletedInvitation.organizationId,
          })
        );
      },
    })
  );
}

function commentCollection(deps: DashboardCollectionDeps) {
  const id = deps.slugCollectionId("commentCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "comment",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(organizationId && slug)) {
          return [];
        }

        // No catch: a policy denial, a lost session or a dropped connection is
        // the query's error state, not an empty thread. An empty list is a
        // successful RPC that found no comments.
        const data = await fetchRpc(
          (rpc) => rpc.ListComments({ organizationId, slug }),
          { signal: ctx.signal }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newComment } = mutation;

        // SAFETY: post-ui attaches the transient author payload declared on
        // PostWithTransientAuthor above.
        const author = (newComment as PostWithTransientAuthor).author;

        await fetchRpc(
          (rpc) =>
            rpc.CreateComment({
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
          deps.client.collection(postActivityCollection(deps)).utils.refetch(),
          deps.client.collection(postCollection(deps)).utils.refetch(),
          deps.client
            .collection(deleteEligibilityCollection(deps))
            .utils.refetch()
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedComment } = mutation;

        await fetchRpc(
          (rpc) =>
            rpc.DeleteComment({
              id: deletedComment.id,
              organizationId: deletedComment.organizationId,
              postId: deletedComment.postId,
            }),
          {}
        );

        // Same as the insert path: the optimistic delete already removed the
        // row, so the derived collections refresh detached.
        refetchInBackground(
          deps.client.collection(postActivityCollection(deps)).utils.refetch(),
          deps.client.collection(postCollection(deps)).utils.refetch(),
          deps.client
            .collection(deleteEligibilityCollection(deps))
            .utils.refetch()
        );
      },
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedComment } = mutation;

        await fetchRpc(
          (rpc) =>
            rpc.UpdateComment({
              id: updatedComment.id,
              organizationId: updatedComment.organizationId,
              postId: updatedComment.postId,
              content: updatedComment.content,
              visibility: updatedComment.visibility,
            }),
          {}
        );

        // Only the activity entry is derived from an edit: refresh it detached.
        refetchInBackground(
          deps.client.collection(postActivityCollection(deps)).utils.refetch()
        );
      },
    })
  );
}

function postActivityCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("postActivityCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: (opts) => {
        const postId = eqFilterValue(
          parseLoadSubsetOptions(opts).filters,
          "postId"
        );

        return postId
          ? deps.organizationScopedQueryKey("post-activity", "postId", postId)
          : deps.organizationScopedQueryKey("post-activity");
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const postId = eqFilterValue(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters,
          "postId"
        );

        if (!(organizationId && postId)) {
          return [];
        }

        const existingData =
          deps.queryClient.getQueryData<readonly TPostActivity[]>(
            ctx.queryKey
          ) ?? [];
        const since = existingData.reduce<Date | undefined>(
          (latest, activity) =>
            latest === undefined || activity.createdAt > latest
              ? activity.createdAt
              : latest,
          undefined
        );
        const changes = await fetchRpc(
          (rpc) =>
            rpc.ListPostActivities({
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
      getKey: (item) => item.id,
    })
  );
}

function commentReactionCollection(deps: DashboardCollectionDeps) {
  const id = deps.slugCollectionId("commentReactionCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "comment-reaction",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(organizationId && slug)) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListCommentReactions({ organizationId, slug }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
      },
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getCommentReactionCollectionKey as (
        item: CommentReactionRow
      ) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newCommentReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.ToggleCommentReaction({
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
          rpc.ToggleCommentReaction({
            organizationId: deletedCommentReaction.organizationId,
            postId: deletedCommentReaction.postId,
            commentId: deletedCommentReaction.commentId,
            emoji: deletedCommentReaction.emoji,
          })
        );
      },
    })
  );
}

function upvoteCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("upvoteCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      // Lazy key: resolved at query time so navigation between organizations
      // never reuses another organization's cache entry (matches queryFn).
      queryKey: () => deps.organizationScopedQueryKey("upvote"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListUpvotes({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
      },
      // SAFETY: The endpoint/API contract guarantees this response shape.
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.ToggleUpvote({
            organizationId: newUpvote.organizationId,
            postId: newUpvote.postId,
          })
        );
        // The upvote row is the mutation target and holds the toggle
        // optimistically; vote counts derive from this collection client-side
        // (post rows carry no count), so the post rows and the delete-hint set
        // are derived refreshes that run detached.
        refetchInBackground(
          deps.client.collection(postCollection(deps)).utils.refetch(),
          deps.client
            .collection(deleteEligibilityCollection(deps))
            .utils.refetch()
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedUpvote } = mutation;

        await fetchRpc((rpc) =>
          rpc.ToggleUpvote({
            organizationId: deletedUpvote.organizationId,
            postId: deletedUpvote.postId,
          })
        );
        // Same as the insert path: derived refreshes run detached.
        refetchInBackground(
          deps.client.collection(postCollection(deps)).utils.refetch(),
          deps.client
            .collection(deleteEligibilityCollection(deps))
            .utils.refetch()
        );
      },
    })
  );
}

/**
 * Creator delete hints for the whole organization, synced once. List rows
 * carry no delete hint (per-row probes on every list fetch); contributor
 * affordances derive from this small set client-side instead, and the
 * backend delete path re-validates. Presence of a row means eligible.
 * Refetch after engagement mutations (see the call sites below).
 */
function deleteEligibilityCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("deleteEligibilityCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("delete-eligibility"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const result = await fetchRpc(
          (rpc) => rpc.ListPostDeleteEligibility({ organizationId }),
          { signal: ctx.signal }
        );
        return result.eligibleIds.map((postId) => ({
          organizationId,
          postId,
        }));
      },
      getKey: (item) => item.postId,
    })
  );
}

function postReactionCollection(deps: DashboardCollectionDeps) {
  const id = deps.slugCollectionId("postReactionCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "post-reaction",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",

      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(organizationId && slug)) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListPostReactions({ organizationId, slug }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
        // SAFETY: The endpoint/API contract guarantees this response shape.
      },
      // SAFETY: The endpoint/API contract guarantees this response shape.
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newPostReaction } = mutation;

        await fetchRpc((rpc) =>
          rpc.TogglePostReaction({
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
          rpc.TogglePostReaction({
            organizationId: deletedPostReaction.organizationId,
            postId: deletedPostReaction.postId,
            emoji: deletedPostReaction.emoji,
          })
        );
      },
    })
  );
}

function siteCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("siteCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("site"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListSites({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      refetchInterval: Duration.toMillis(Duration.minutes(30)),
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedSite } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateSite({
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
}

function workspacePlanCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("workspacePlanCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("workspace-plan"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.GetWorkspacePlan({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [data];
      },
      getKey: (item) => item.organizationId,
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
}

/**
 * The workspace's live over-plan findings, one row per workspace.
 *
 * The gate reads this on every dashboard route. The RPC counts first and
 * fetches resource previews only when a finding is already over, so a
 * compliant workspace costs a handful of indexed counts and nothing else.
 * `staleTime` is infinite on purpose: the plan changes through a webhook, and
 * the gate refetches this collection after every remediation action, so there
 * is nothing to poll.
 */
function planComplianceCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("planComplianceCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("plan-compliance"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.GetWorkspacePlanCompliance({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [data];
      },
      getKey: (item) => item.organizationId,
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
}

/**
 * The plan-compliance collection for an explicit workspace.
 *
 * Route loaders run before the URL reflects the navigation, so they cannot use
 * `dashboardCollections`, whose scope comes from the live pathname. Naming the
 * workspace is what keeps a gate check on the destination from reading the
 * source organization's snapshot.
 */
/**
 * The plan-compliance collection for an explicit workspace.
 *
 * Route loaders run before the URL reflects the navigation, so they cannot use
 * `dashboardCollections`, whose scope comes from the live pathname. Naming the
 * workspace is what keeps a gate check on the destination from reading the
 * source organization's snapshot.
 */
export const planComplianceCollectionFor = (organizationId: string) => {
  const client = getBrowserDbClient();
  const scope: DashboardCollectionScope = {
    organizationId,
    postSlug: undefined,
  };

  return materialize(
    client,
    planComplianceCollection(dashboardCollectionDeps(client, scope))
  );
};

function postSubscriptionCollection(deps: DashboardCollectionDeps) {
  const id = deps.slugCollectionId("postSubscriptionCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: (opts) =>
        deps.slugScopedQueryKey(
          "post-subscription",
          parseLoadSubsetOptions(opts).filters
        ),
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        const slug = deps.resolvePostSlug(
          parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions).filters
        );

        if (!(organizationId && slug)) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListPostSubscriptions({ organizationId, slug }),
          {
            signal: ctx.signal,
          }
        );
        // SAFETY: The endpoint/API contract guarantees this response shape.
        return [...data];
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      },
      // SAFETY: The endpoint/API contract guarantees this response shape.
      // SAFETY: The endpoint/API contract guarantees this response shape.
      getKey: getPostSubscriptionCollectionKey as (
        item: PostSubscriptionRow
      ) => string,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newSubscription } = mutation;

        await fetchRpc((rpc) =>
          rpc.CreatePostSubscription({
            organizationId: newSubscription.organizationId,
            postId: newSubscription.postId,
          })
        );
      },
      onDelete: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { original: deletedSubscription } = mutation;

        await fetchRpc((rpc) =>
          rpc.DeletePostSubscription({
            organizationId: deletedSubscription.organizationId,
            postId: deletedSubscription.postId,
          })
        );
      },
    })
  );
}

function jwtSecretCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("jwtSecretCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("jwt-secret"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListJwtSecrets({ organizationId }),
          { signal: ctx.signal }
        );
        return [...data];
      },
      getKey: (item) => item.id,
    })
  );
}

function contactCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("contactCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("contact"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListContacts({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedContact } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateContact({
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
          rpc.CreateContact({
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
          rpc.DeleteContact({
            id: deletedContact.id,
            organizationId: deletedContact.organizationId,
          })
        );
      },
    })
  );
}

function companyCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("companyCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("company"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListCompanies({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: updatedCompany } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateCompany({
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
          rpc.CreateCompany({
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
          rpc.DeleteCompany({
            id: deletedCompany.id,
            organizationId: deletedCompany.organizationId,
          })
        );
      },
    })
  );
}

//Todo scope
function contactAttributeDefinitionCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("contactAttributeDefinitionCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () =>
        deps.organizationScopedQueryKey("contact-attribute-definition"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListContactAttributeDefinitions({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: definition } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateContactAttributeDefinition({
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
          rpc.CreateContactAttributeDefinition({
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
          rpc.DeleteContactAttributeDefinition({
            id: definition.id,
            organizationId: definition.organizationId,
          })
        );
      },
    })
  );
}

//Todo scope
function companyAttributeDefinitionCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("companyAttributeDefinitionCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () =>
        deps.organizationScopedQueryKey("company-attribute-definition"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListCompanyAttributeDefinitions({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onUpdate: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: definition } = mutation;

        await fetchRpc((rpc) =>
          rpc.UpdateCompanyAttributeDefinition({
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
          rpc.CreateCompanyAttributeDefinition({
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
          rpc.DeleteCompanyAttributeDefinition({
            id: definition.id,
            organizationId: definition.organizationId,
          })
        );
      },
    })
  );
}

function contactAttributeValueCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("contactAttributeValueCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () =>
        deps.organizationScopedQueryKey("contact-attribute-value"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListContactAttributeValues({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
    })
  );
}

function companyAttributeValueCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("companyAttributeValueCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () =>
        deps.organizationScopedQueryKey("company-attribute-value"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListCompanyAttributeValues({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
    })
  );
}

function roadmapCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("roadmapCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("roadmap"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();
        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListRoadmaps({ organizationId }),
          {
            signal: ctx.signal,
          }
        );
        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newRoadmap } = mutation;

        await fetchRpc((rpc) =>
          rpc.CreateRoadmap({
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
          rpc.UpdateRoadmap({
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
          rpc.DeleteRoadmap({
            id: deletedRoadmap.id,
            organizationId: deletedRoadmap.organizationId,
          })
        );

        // Deleting the primary promotes a successor in the same server
        // transaction; read the rows back so the cached `isPrimary` flags match
        // the handoff instead of leaving the organization without a primary in
        // the client cache.
        await deps.client.collection(roadmapCollection(deps)).utils.refetch();
      },
    })
  );
}

function roadmapColumnCollection(deps: DashboardCollectionDeps) {
  const id = deps.collectionId("roadmapColumnCollection");

  return collectionOptions(id, () =>
    queryCollectionOptions({
      id,
      queryClient: deps.queryClient,
      queryKey: () => deps.organizationScopedQueryKey("roadmap-column"),
      queryFn: async (ctx) => {
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          return [];
        }

        const data = await fetchRpc(
          (rpc) => rpc.ListRoadmapColumns({ organizationId }),
          { signal: ctx.signal }
        );

        return [...data];
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const mutation = transaction.mutations[0];
        const { modified: newColumn } = mutation;
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          throw new Error("Missing organization id");
        }

        await fetchRpc((rpc) =>
          rpc.CreateRoadmapColumn({
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
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          throw new Error("Missing organization id");
        }

        await fetchRpc((rpc) =>
          rpc.UpdateRoadmapColumn({
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
        const organizationId = deps.getOrganizationId();

        if (!organizationId) {
          throw new Error("Missing organization id");
        }

        await fetchRpc((rpc) =>
          rpc.DeleteRoadmapColumn({
            id: deletedColumn.id,
            roadmapId: deletedColumn.roadmapId,
            organizationId,
          })
        );
      },
    })
  );
}

/**
 * `createIndex` is a `Collection` method rather than a config field, so an index
 * cannot live in a descriptor config. Indexes are applied on first
 * materialization instead, keyed by collection id — which is what `DbClient`
 * memoizes on — so repeated reads do not stack duplicate indexes.
 *
 * The set is per client, not per module: a collection id is unique within one
 * `DbClient`, and two clients (a test's, or one request's per-request client
 * once the dashboard renders on the server) each need their own copy indexed.
 * Keying only on the id left every client after the first without indexes,
 * which is invisible until a query stops using them.
 */
const indexedCollectionIds = new WeakMap<DbClient, Set<string>>();

/**
 * Materializes a descriptor with the row type its factory declares.
 *
 * `DbClient.collection` resolves its overload from the descriptor alone, and
 * under TypeScript 7.1 the schema-taking overload also matches a schema-less
 * descriptor: `T` is inferred as `never`, so a collection materialized through
 * it answers every live query with `never` rows. Naming the three type
 * arguments selects the schema-less overload, which keeps `T` — the row type
 * `queryCollectionOptions` inferred from the descriptor's `queryFn`.
 */
function materialize<
  T extends object,
  TKey extends string | number,
  TUtils extends UtilsRecord,
>(
  client: DbClient,
  descriptor: CollectionOptions<T, TKey, never, TUtils> & NonSingleResult
) {
  return client.collection<T, TKey, TUtils>(descriptor);
}

function withIndexesFor(client: DbClient) {
  let indexed = indexedCollectionIds.get(client);

  if (indexed === undefined) {
    indexed = new Set<string>();
    indexedCollectionIds.set(client, indexed);
  }

  return <TCollection extends { id: string }>(
    collection: TCollection,
    addIndexes: (collection: TCollection) => void
  ): TCollection => {
    if (!indexed.has(collection.id)) {
      indexed.add(collection.id);
      addIndexes(collection);
    }

    return collection;
  };
}

/**
 * Materializes every dashboard collection for the current scope through the
 * browser `DbClient`.
 *
 * Getter-based rather than a frozen map so a collection's identity follows the
 * current organization (and post) instead of being fixed at module load. The
 * `DbClient` memoizes by descriptor id, so repeated reads within one scope
 * return the same instance and React memo dependencies stay stable.
 */

/**
 * Materializes every dashboard collection for one client and scope.
 *
 * The whole set is built from one `deps` value, so every descriptor shares the
 * client, the query client, and the captured scope, and no descriptor can
 * resolve a different identity than its neighbours. `DbClient.collection`
 * memoizes by descriptor id, so a descriptor built here and a descriptor built
 * by a cross-reference inside another collection's mutation handler point at
 * the same instance.
 */
export function createDashboardCollections({
  client,
  scope,
}: {
  readonly client: DbClient;
  readonly scope: DashboardCollectionScope;
}) {
  const deps = dashboardCollectionDeps(client, scope);
  const indexOnce = withIndexesFor(client);

  return {
    boardCollection: indexOnce(
      materialize(client, boardCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
        // Post board queries join posts against boards by id.
        collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        });
      }
    ),
    changelogCategoryCollection: materialize(
      client,
      changelogCategoryCollection(deps)
    ),
    changelogCategoryLinkCollection: materialize(
      client,
      changelogCategoryLinkCollection(deps)
    ),
    changelogCollection: materialize(client, changelogCollection(deps)),
    changelogPostCollection: indexOnce(
      materialize(client, changelogPostCollection(deps)),
      (collection) => {
        // Changelog completed-posts joins entries against posts by post id.
        collection.createIndex((row) => row.postId, {
          indexType: BasicIndex,
        });
      }
    ),
    commentCollection: materialize(client, commentCollection(deps)),
    commentReactionCollection: materialize(
      client,
      commentReactionCollection(deps)
    ),
    companyCollection: materialize(client, companyCollection(deps)),
    deleteEligibilityCollection: indexOnce(
      materialize(client, deleteEligibilityCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.postId, {
          indexType: BasicIndex,
        });
      }
    ),
    companyAttributeDefinitionCollection: materialize(
      client,
      companyAttributeDefinitionCollection(deps)
    ),
    companyAttributeValueCollection: materialize(
      client,
      companyAttributeValueCollection(deps)
    ),
    contactAttributeDefinitionCollection: materialize(
      client,
      contactAttributeDefinitionCollection(deps)
    ),
    contactAttributeValueCollection: materialize(
      client,
      contactAttributeValueCollection(deps)
    ),
    contactCollection: materialize(client, contactCollection(deps)),
    invitationsCollection: materialize(client, invitationsCollection(deps)),
    jwtSecretCollection: materialize(client, jwtSecretCollection(deps)),
    membersCollection: materialize(client, membersCollection(deps)),
    membershipCollection: indexOnce(
      materialize(client, membershipCollection(deps)),
      (collection) => {
        // Workspace details joins memberships against organizations by org id.
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
      }
    ),
    organizationCollection: indexOnce(
      materialize(client, organizationCollection(deps)),
      (collection) => {
        // Workspace details joins memberships against organizations by org id.
        collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        });
      }
    ),
    postCollection: indexOnce(
      materialize(client, postCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.createdAt, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.statusId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.boardId, {
          indexType: BasicIndex,
        });
      }
    ),
    postDetailCollection: materialize(client, postDetailCollection(deps)),
    postActivityCollection: materialize(client, postActivityCollection(deps)),
    postReactionCollection: materialize(client, postReactionCollection(deps)),
    postStatusCollection: indexOnce(
      materialize(client, postStatusCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
        // Board, changelog, and merge queries join posts against status rows by id.
        collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        });
      }
    ),
    postSubscriptionCollection: materialize(
      client,
      postSubscriptionCollection(deps)
    ),
    roadmapCollection: materialize(client, roadmapCollection(deps)),
    roadmapColumnCollection: indexOnce(
      materialize(client, roadmapColumnCollection(deps)),
      (collection) => {
        // Roadmap columns join statuses and roadmaps by their foreign keys.
        collection.createIndex((row) => row.statusId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.roadmapId, {
          indexType: BasicIndex,
        });
      }
    ),
    postTagCollection: indexOnce(
      materialize(client, postTagCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.postId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.tagId, {
          indexType: BasicIndex,
        });
      }
    ),
    siteCollection: materialize(client, siteCollection(deps)),
    tagCollection: indexOnce(
      materialize(client, tagCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
      }
    ),
    upvoteCollection: indexOnce(
      materialize(client, upvoteCollection(deps)),
      (collection) => {
        collection.createIndex((row) => row.organizationId, {
          indexType: BasicIndex,
        });
        collection.createIndex((row) => row.postId, {
          indexType: BasicIndex,
        });
      }
    ),
    workspacePlanCollection: materialize(client, workspacePlanCollection(deps)),
    planComplianceCollection: materialize(
      client,
      planComplianceCollection(deps)
    ),
  };
}

export type DashboardCollections = ReturnType<
  typeof createDashboardCollections
>;

/**
 * Built collections per client and captured scope.
 *
 * The accessor reads the live pathname on every property access, so the scope
 * changes when the route does; keying on it is what keeps a navigation between
 * workspaces from reusing the previous workspace's set. `DbClient` already
 * memoizes by descriptor id, so an entry here saves the descriptor objects, not
 * the rows.
 */
const collectionsByScope = new WeakMap<
  DbClient,
  Map<string, DashboardCollections>
>();

function collectionsFor(
  client: DbClient,
  scope: DashboardCollectionScope
): DashboardCollections {
  let byScope = collectionsByScope.get(client);

  if (byScope === undefined) {
    byScope = new Map();
    collectionsByScope.set(client, byScope);
  }

  const key = dashboardScopeKey(scope);
  const existing = byScope.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const collections = createDashboardCollections({ client, scope });
  byScope.set(key, collections);

  return collections;
}

function currentCollections(): DashboardCollections {
  return collectionsFor(getBrowserDbClient(), currentDashboardScope());
}

/**
 * Every dashboard collection, for the scope the browser is on.
 *
 * Getter-based rather than a frozen map because a property read is what pins a
 * collection to the current organization (and post); a frozen map would fix the
 * identity at module load, which is what the earlier singleton shape did. The
 * getters only resolve *which* set to read — every rule about what a collection
 * is lives in `createDashboardCollections` and its deps.
 */
export const dashboardCollections = {
  get boardCollection() {
    return currentCollections().boardCollection;
  },
  get changelogCategoryCollection() {
    return currentCollections().changelogCategoryCollection;
  },
  get changelogCategoryLinkCollection() {
    return currentCollections().changelogCategoryLinkCollection;
  },
  get changelogCollection() {
    return currentCollections().changelogCollection;
  },
  get changelogPostCollection() {
    return currentCollections().changelogPostCollection;
  },
  get commentCollection() {
    return currentCollections().commentCollection;
  },
  get commentReactionCollection() {
    return currentCollections().commentReactionCollection;
  },
  get companyCollection() {
    return currentCollections().companyCollection;
  },
  get deleteEligibilityCollection() {
    return currentCollections().deleteEligibilityCollection;
  },
  get companyAttributeDefinitionCollection() {
    return currentCollections().companyAttributeDefinitionCollection;
  },
  get companyAttributeValueCollection() {
    return currentCollections().companyAttributeValueCollection;
  },
  get contactAttributeDefinitionCollection() {
    return currentCollections().contactAttributeDefinitionCollection;
  },
  get contactAttributeValueCollection() {
    return currentCollections().contactAttributeValueCollection;
  },
  get contactCollection() {
    return currentCollections().contactCollection;
  },
  get invitationsCollection() {
    return currentCollections().invitationsCollection;
  },
  get jwtSecretCollection() {
    return currentCollections().jwtSecretCollection;
  },
  get membersCollection() {
    return currentCollections().membersCollection;
  },
  get membershipCollection() {
    return currentCollections().membershipCollection;
  },
  get organizationCollection() {
    return currentCollections().organizationCollection;
  },
  get postCollection() {
    return currentCollections().postCollection;
  },
  get postDetailCollection() {
    return currentCollections().postDetailCollection;
  },
  get postActivityCollection() {
    return currentCollections().postActivityCollection;
  },
  get postReactionCollection() {
    return currentCollections().postReactionCollection;
  },
  get postStatusCollection() {
    return currentCollections().postStatusCollection;
  },
  get postSubscriptionCollection() {
    return currentCollections().postSubscriptionCollection;
  },
  get roadmapCollection() {
    return currentCollections().roadmapCollection;
  },
  get roadmapColumnCollection() {
    return currentCollections().roadmapColumnCollection;
  },
  get postTagCollection() {
    return currentCollections().postTagCollection;
  },
  get siteCollection() {
    return currentCollections().siteCollection;
  },
  get tagCollection() {
    return currentCollections().tagCollection;
  },
  get upvoteCollection() {
    return currentCollections().upvoteCollection;
  },
  get workspacePlanCollection() {
    return currentCollections().workspacePlanCollection;
  },
  get planComplianceCollection() {
    return currentCollections().planComplianceCollection;
  },
};
