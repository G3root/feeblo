import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import { Duration } from "effect";
import * as TanstackQuery from "~/integrations/tanstack-query/root-provider";
import { fetchRpc } from "./runtime";

export const postCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["post"];
      for (const { field, value } of parsed.filters) {
        const fieldName = field.join(".");
        if (fieldName === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
        if (fieldName === "boardId") {
          cacheKey.push(`boardId-${value}`);
        }
      }

      return cacheKey;
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);

      const filters: {
        boardId?: string;
        organizationId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");

          if (fieldName === "boardId") {
            filters.boardId = value as string;
          }
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
        }
      }

      const boardId = filters?.boardId;
      const organizationId = filters?.organizationId;
      if (!boardId) {
        return [];
      }
      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostList({ boardId, organizationId }),
        {
          signal: ctx.signal,
        }
      );

      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;

      await fetchRpc((rpc) =>
        rpc.PostUpdate({
          id: updatedPost.id,
          status: updatedPost.status,
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
          status: newPost.status,
        })
      );
    },
  })
);

export const boardCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["board"];
      for (const { field, value } of parsed.filters) {
        if (field.join(".") === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
      }

      return cacheKey;
    },
    syncMode: "on-demand",
    refetchInterval: Duration.toMillis(Duration.minutes(5)),
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const filters: {
        organizationId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");

          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
        }
      }

      const organizationId = filters.organizationId;

      if (!organizationId) {
        throw new Error("organizationId is required");
      }

      const data = await fetchRpc((rpc) => rpc.BoardList({ organizationId }), {
        signal: ctx.signal,
      });
      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
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

export const membershipCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["membership"],
    refetchInterval: Duration.toMillis(Duration.minutes(10)),
    queryFn: async (args) =>
      fetchRpc((rpc) => rpc.MembershipList(), { signal: args.signal }).then(
        (data) => [...data]
      ),
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
  })
);

export const membersCollection = createCollection(
  queryCollectionOptions({
    staleTime: Duration.toMillis(Duration.minutes(20)),
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["members"];
      for (const { field, value } of parsed.filters) {
        if (field.join(".") === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
      }

      return cacheKey;
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      let organizationId: string | undefined;

      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq" && field.join(".") === "organizationId") {
          organizationId = value as string;
        }
      }

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) =>
        rpc.OrganizationMembersList({ organizationId })
      );
      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
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
      const primaryRole = (updatedMember.role?.split(",")[0] ?? "member") as
        | "owner"
        | "admin"
        | "member";

      await fetchRpc((rpc) =>
        rpc.OrganizationUpdateMemberRole({
          memberId: updatedMember.id,
          organizationId: updatedMember.organizationId,
          role: primaryRole === "owner" ? "admin" : primaryRole,
        })
      );
    },
  })
);

export const invitationsCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["invitations"];
      for (const { field, value } of parsed.filters) {
        if (field.join(".") === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
      }
      return cacheKey;
    },
    syncMode: "on-demand",
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      let organizationId: string | undefined;

      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq" && field.join(".") === "organizationId") {
          organizationId = value as string;
        }
      }

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc((rpc) =>
        rpc.OrganizationInvitationsList({ organizationId })
      );
      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
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
      const cacheKey = ["comment"];
      for (const { field, value } of parsed.filters) {
        const fieldName = field.join(".");
        if (fieldName === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
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
        organizationId?: string;
        postId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
          if (fieldName === "postId") {
            filters.postId = value as string;
          }
        }
      }
      const organizationId = filters?.organizationId;
      const postId = filters?.postId;
      if (!organizationId) {
        return [];
      }
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
    queryClient: TanstackQuery.getContext().queryClient,
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

export const commentReactionCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["commentReaction"];
      for (const { field, value } of parsed.filters) {
        const fieldName = field.join(".");
        if (fieldName === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
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
        organizationId?: string;
        postId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
          if (fieldName === "postId") {
            filters.postId = value as string;
          }
        }
      }

      const organizationId = filters.organizationId;
      const postId = filters.postId;
      if (!organizationId) {
        return [];
      }
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
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
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
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["upvote"];
      for (const { field, value } of parsed.filters) {
        const fieldName = field.join(".");
        if (fieldName === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
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
        organizationId?: string;
        postId?: string;
      } = {};

      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
          if (fieldName === "postId") {
            filters.postId = value as string;
          }
        }
      }

      const organizationId = filters.organizationId;
      const postId = filters.postId;
      if (!organizationId) {
        return [];
      }
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
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
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
      const cacheKey = ["postReaction"];
      for (const { field, value } of parsed.filters) {
        const fieldName = field.join(".");
        if (fieldName === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
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
        organizationId?: string;
        postId?: string;
      } = {};

      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
          if (fieldName === "postId") {
            filters.postId = value as string;
          }
        }
      }

      const organizationId = filters.organizationId;
      const postId = filters.postId;
      if (!organizationId) {
        return [];
      }
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
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
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
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["site"];
      for (const { field, value } of parsed.filters) {
        if (field.join(".") === "organizationId") {
          cacheKey.push(`organizationId-${value}`);
        }
      }

      return cacheKey;
    },
    syncMode: "on-demand",
    queryFn: async (args) => {
      const parsed = parseLoadSubsetOptions(args.meta?.loadSubsetOptions);
      const filters: {
        organizationId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
        }
      }
      const organizationId = filters?.organizationId;

      if (!organizationId) {
        return [];
      }
      const data = await fetchRpc((rpc) => rpc.SiteList({ organizationId }), {
        signal: args.signal,
      });
      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
    refetchInterval: Duration.toMillis(Duration.minutes(30)),
  })
);
