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
        throw new Error("boardId is required");
      }
      if (!organizationId) {
        throw new Error("organizationId is required");
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
