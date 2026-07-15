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
  if (typeof window === "undefined") {
    return undefined;
  }

  const [organizationId] = window.location.pathname
    .split("/")
    .filter((segment) => segment.length > 0);

  return organizationId ? decodeURIComponent(organizationId) : undefined;
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

export const postCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("post"),
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
      const { original: deletedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostDelete({
          id: deletedPost.id,
          boardId: deletedPost.boardId,
          organizationId: deletedPost.organizationId,
        })
      );
    },
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
  })
);

postCollection.createIndex((row) => row.createdAt, {
  indexType: BasicIndex,
});

postCollection.createIndex((row) => row.statusId, {
  indexType: BasicIndex,
});

export const postStatusCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("post-status"),
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

export const changelogCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("changelog"),
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
          status: newChangelog.status,
          scheduledAt: newChangelog.scheduledAt,
          publishedAt: newChangelog.publishedAt,
          organizationId: newChangelog.organizationId,
        })
      );
    },
  })
);

export const boardCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("board"),
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

export const tagCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("tag"),

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
          type: newTag.type,
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
          type: updatedTag.type,
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

export const postTagCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("post-tag"),

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

export const changelogTagCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("changelog-tag"),
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ChangelogTagList({ organizationId }),
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

export const membershipCollection = createCollection(
  queryCollectionOptions({
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

export const organizationCollection = createCollection(
  queryCollectionOptions({
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

export const membersCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(20)),
    queryKey: () => getOrganizationScopedQueryKey("members"),
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
    queryKey: () => getOrganizationScopedQueryKey("invitations"),

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
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("comment", "postId", postId)
        : getOrganizationScopedQueryKey("comment");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
        return [];
      }

      try {
        const data = await fetchRpc(
          (rpc) => rpc.CommentList({ organizationId, postId }),
          { signal: ctx.signal }
        );
        return [...data];
      } catch (_error) {
        return [];
      }
    },
    queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: newComment } = mutation;

      await fetchRpc(
        (rpc) =>
          rpc.CommentCreate({
            organizationId: newComment.organizationId,
            visibility: newComment.visibility,
            content: newComment.content,
            postId: newComment.postId,
            parentCommentId: newComment.parentCommentId,
            id: newComment.id,
          }),
        {}
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
    },
  })
);

export const commentReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("comment-reaction", "postId", postId)
        : getOrganizationScopedQueryKey("comment-reaction");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CommentReactionList({ organizationId, postId }),
        {
          signal: ctx.signal,
        }
      );
      return [...data];
    },
    queryClient,
    getKey: getCommentReactionCollectionKey as (
      item: CommentReactionRow
    ) => string,
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
    queryKey: getOrganizationScopedQueryKey("upvote"),
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
    queryClient,
    getKey: getUpvoteCollectionKey as (item: UpvoteRow) => string,
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

export const postReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("post-reaction", "postId", postId)
        : getOrganizationScopedQueryKey("post-reaction");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
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
    getKey: getPostReactionCollectionKey as (item: PostReactionRow) => string,
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
    queryKey: () => getOrganizationScopedQueryKey("site"),
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
          name: updatedSite.name,
        })
      );
    },
  })
);

export const workspaceProductCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["workspace-product"],
    queryFn: async (ctx) => {
      const data = await fetchRpc((rpc) => rpc.WorkspaceProductList(), {
        signal: ctx.signal,
      });
      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
    staleTime: Number.POSITIVE_INFINITY,
  })
);

export const workspacePlanCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("workspace-plan"),
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
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const postId = getEqFilterValue(parsed.filters, "postId");

      return postId
        ? getOrganizationScopedQueryKey("post-subscription", "postId", postId)
        : getOrganizationScopedQueryKey("post-subscription");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const organizationId = getCurrentOrganizationId();
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const postId = getEqFilterValue(parsed.filters, "postId");

      if (!(organizationId && postId)) {
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

export const jwtSecretCollection = createCollection(
  queryCollectionOptions({
    queryKey: () => getOrganizationScopedQueryKey("jwt-secret"),
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
    queryKey: () => getOrganizationScopedQueryKey("contact"),
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
    queryKey: () => getOrganizationScopedQueryKey("company"),
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
    queryKey: () =>
      getOrganizationScopedQueryKey("contact-attribute-definition"),
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
          type: definition.type,
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
    queryKey: () =>
      getOrganizationScopedQueryKey("company-attribute-definition"),
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
          type: definition.type,
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

//Todo scope
export const contactAttributeValueCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const contactId = getEqFilterValue(parsed.filters, "contactId");

      return contactId
        ? getOrganizationScopedQueryKey(
            "contact-attribute-value",
            "contactId",
            contactId
          )
        : getOrganizationScopedQueryKey("contact-attribute-value");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const contactId = getEqFilterValue(parsed.filters, "contactId");

      if (!contactId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.ContactAttributeValueList({ contactId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

//Todo scope
export const companyAttributeValueCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const companyId = getEqFilterValue(parsed.filters, "companyId");

      return companyId
        ? getOrganizationScopedQueryKey(
            "company-attribute-value",
            "companyId",
            companyId
          )
        : getOrganizationScopedQueryKey("company-attribute-value");
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const companyId = getEqFilterValue(parsed.filters, "companyId");

      if (!companyId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.CompanyAttributeValueList({ companyId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient,
    getKey: (item) => item.id,
  })
);

export const dashboardCollections = {
  boardCollection,
  changelogCollection,
  changelogTagCollection,
  commentCollection,
  commentReactionCollection,
  companyCollection,
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
  postReactionCollection,
  postStatusCollection,
  postSubscriptionCollection,
  postTagCollection,
  siteCollection,
  tagCollection,
  upvoteCollection,
  workspacePlanCollection,
  workspaceProductCollection,
};

export type DashboardCollections = typeof dashboardCollections;
