import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { Duration } from "effect";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
  getUpvoteCollectionKey,
} from "~/lib/reaction-keys";
import { fetchRpc } from "./runtime";

type DashboardCollectionScope = {
  organizationId: string;
  queryClient: QueryClient;
};

export function createDashboardCollections({
  organizationId,
  queryClient,
}: DashboardCollectionScope) {
  const postCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`post-${organizationId}`],
      queryFn: async (ctx) => {
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

  const postStatusCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`post-status-${organizationId}`],
      queryFn: async (ctx) => {
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

  const changelogCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`changelog-${organizationId}`],
      queryFn: async (ctx) => {
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

  const boardCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`board-${organizationId}`],
      refetchInterval: Duration.toMillis(Duration.minutes(5)),
      queryFn: async (ctx) => {
        const data = await fetchRpc(
          (rpc) => rpc.BoardList({ organizationId }),
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

  const tagCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`tag-${organizationId}`],

      queryFn: async (ctx) => {
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

  const postTagCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`post-tag-${organizationId}`],

      queryFn: async (ctx) => {
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

  const changelogTagCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`changelog-tag-${organizationId}`],
      queryFn: async (ctx) => {
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

  const membershipCollection = createCollection(
    queryCollectionOptions({
      queryKey: ["membership"],
      staleTime: Duration.toMillis(Duration.minutes(10)),
      queryFn: async (args) =>
        fetchRpc((rpc) => rpc.MembershipList(), { signal: args.signal }).then(
          (data) => [...data]
        ),
      queryClient,
      getKey: (item) => item.id,
    })
  );

  const organizationCollection = createCollection(
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

  const membersCollection = createCollection(
    queryCollectionOptions({
      staleTime: Duration.toMillis(Duration.minutes(20)),
      queryKey: [`members-${organizationId}`],
      queryFn: async () => {
        const data = await fetchRpc((rpc) =>
          rpc.OrganizationMembersList({ organizationId })
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

  const invitationsCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`invitations-${organizationId}`],

      queryFn: async () => {
        const data = await fetchRpc((rpc) =>
          rpc.OrganizationInvitationsList({ organizationId })
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

  const commentCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const cacheKey = [`comment-${organizationId}`];
        for (const { field, value } of parsed.filters) {
          const fieldName = field.join(".");

          if (fieldName === "postId") {
            cacheKey.push(`postId-${value}`);
          }
        }
        return cacheKey;
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const filters: {
          postId?: string;
        } = {};
        for (const { field, operator, value } of parsed.filters) {
          if (operator === "eq") {
            const fieldName = field.join(".");

            if (fieldName === "postId") {
              filters.postId = value as string;
            }
          }
        }

        const postId = filters?.postId;

        if (!postId) {
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
            }),
          {}
        );
      },
    })
  );

  const commentReactionCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const cacheKey = [`commentReaction-${organizationId}`];
        for (const { field, value } of parsed.filters) {
          const fieldName = field.join(".");
          if (fieldName === "postId") {
            cacheKey.push(`postId-${value}`);
          }
        }
        return cacheKey;
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const filters: {
          postId?: string;
        } = {};
        for (const { field, operator, value } of parsed.filters) {
          if (operator === "eq") {
            const fieldName = field.join(".");

            if (fieldName === "postId") {
              filters.postId = value as string;
            }
          }
        }

        const postId = filters.postId;

        if (!postId) {
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

  const upvoteCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const cacheKey = [`upvote-${organizationId}`];
        for (const { field, value } of parsed.filters) {
          const fieldName = field.join(".");

          if (fieldName === "postId") {
            cacheKey.push(`postId-${value}`);
          }
        }

        return cacheKey;
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const filters: {
          postId?: string;
        } = {};

        for (const { field, operator, value } of parsed.filters) {
          if (operator === "eq") {
            const fieldName = field.join(".");

            if (fieldName === "postId") {
              filters.postId = value as string;
            }
          }
        }

        const postId = filters.postId;

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

  const postReactionCollection = createCollection(
    queryCollectionOptions({
      queryKey: (opts) => {
        const parsed = parseLoadSubsetOptions(opts);
        const cacheKey = [`postReaction-${organizationId}`];
        for (const { field, value } of parsed.filters) {
          const fieldName = field.join(".");
          if (fieldName === "postId") {
            cacheKey.push(`postId-${value}`);
          }
        }

        return cacheKey;
      },
      syncMode: "on-demand",
      queryFn: async (ctx) => {
        const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
        const filters: {
          postId?: string;
        } = {};

        for (const { field, operator, value } of parsed.filters) {
          if (operator === "eq") {
            const fieldName = field.join(".");
            if (fieldName === "postId") {
              filters.postId = value as string;
            }
          }
        }

        const postId = filters.postId;

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

  const siteCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`site-${organizationId}`],
      queryFn: async (args) => {
        const data = await fetchRpc((rpc) => rpc.SiteList({ organizationId }), {
          signal: args.signal,
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

  const workspaceProductCollection = createCollection(
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

  const workspacePlanCollection = createCollection(
    queryCollectionOptions({
      queryKey: [`workspace-plan-${organizationId}`],
      queryFn: async (ctx) => {
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

  return {
    boardCollection,
    changelogCollection,
    changelogTagCollection,
    commentCollection,
    commentReactionCollection,
    invitationsCollection,
    membersCollection,
    membershipCollection,
    organizationCollection,
    postCollection,
    postReactionCollection,
    postStatusCollection,
    postTagCollection,
    siteCollection,
    tagCollection,
    upvoteCollection,
    workspacePlanCollection,
    workspaceProductCollection,
  };
}

export type DashboardCollections = ReturnType<
  typeof createDashboardCollections
>;
