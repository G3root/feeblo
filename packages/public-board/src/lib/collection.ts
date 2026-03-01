import type { Rpc } from "@feeblo/rpc-client";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/svelte-db";
import { QueryClient } from "@tanstack/svelte-query";
import { Duration, type Effect, Exit } from "effect";

const queryClient = new QueryClient();
let rpcRuntimePromise: Promise<typeof import("@feeblo/rpc-client")> | null =
  null;

function getRpcRuntime() {
  if (!rpcRuntimePromise) {
    rpcRuntimePromise = import("@feeblo/rpc-client");
  }

  return rpcRuntimePromise;
}

async function fetchRpc<A, E>(
  cb: (rpc: Rpc) => Effect.Effect<A, E>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  const { runtime, withRpc } = await getRpcRuntime();

  const result = await runtime.runPromiseExit(withRpc(cb), {
    signal: options?.signal,
  });

  if (Exit.isFailure(result)) {
    throw result.cause;
  }

  return result.value;
}

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
        // if (fieldName === "boardId") {
        //   cacheKey.push(`boardId-${value}`);
        // }
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

          // if (fieldName === "boardId") {
          //   filters.boardId = value as string;
          // }
          if (fieldName === "organizationId") {
            filters.organizationId = value as string;
          }
        }
      }

      // const boardId = filters?.boardId;
      const organizationId = filters?.organizationId;

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.PostListPublic({ organizationId, boardId: undefined }),
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
          status: updatedPost.status,
          content: updatedPost.content,
          title: updatedPost.title,
          boardId: updatedPost.boardId,
          organizationId: updatedPost.organizationId,
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

      const data = await fetchRpc(
        (rpc) => rpc.BoardListPublic({ organizationId }),
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
          (rpc) => rpc.CommentListPublic({ organizationId, postId }),
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

export const membersCollection = createCollection(
  queryCollectionOptions({
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
      const primaryRole = (
        updatedMember.role?.split(",")[0] ?? "member"
      ) as "owner" | "admin" | "member";
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
