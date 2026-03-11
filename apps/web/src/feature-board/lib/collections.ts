import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import { Duration } from "effect";
import * as TanstackQuery from "~/integrations/tanstack-query/root-provider";
import { fetchRpc } from "~/lib/runtime";

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
        if (operator !== "eq") {
          continue;
        }

        const fieldName = field.join(".");

        if (fieldName === "boardId") {
          filters.boardId = value as string;
        }

        if (fieldName === "organizationId") {
          filters.organizationId = value as string;
        }
      }

      const boardId = filters.boardId;
      const organizationId = filters.organizationId;

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) =>
          rpc.PostListPublic({
            boardId,
            organizationId,
          }),
        { signal: ctx.signal }
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
      let organizationId: string | undefined;

      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq" && field.join(".") === "organizationId") {
          organizationId = value as string;
        }
      }

      if (!organizationId) {
        return [];
      }

      const data = await fetchRpc(
        (rpc) => rpc.BoardListPublic({ organizationId }),
        { signal: ctx.signal }
      );

      return [...data];
    },
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
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
        if (operator !== "eq") {
          continue;
        }

        const fieldName = field.join(".");

        if (fieldName === "organizationId") {
          filters.organizationId = value as string;
        }

        if (fieldName === "postId") {
          filters.postId = value as string;
        }
      }

      const organizationId = filters.organizationId;
      const postId = filters.postId;

      if (!(organizationId && postId)) {
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
    queryClient: TanstackQuery.getContext().queryClient,
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
