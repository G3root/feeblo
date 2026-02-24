import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection, parseLoadSubsetOptions } from "@tanstack/react-db";
import * as TanstackQuery from "~/integrations/tanstack-query/root-provider";
import { fetchRpc } from "./runtime";

export const postCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => {
      const parsed = parseLoadSubsetOptions(opts);
      const cacheKey = ["post"];
      for (const f of parsed.filters) {
        cacheKey.push(`${f.field.join(".")}-${f.operator}-${f.value}`);
      }

      if (parsed.limit) {
        cacheKey.push(`limit-${parsed.limit}`);
      }

      return cacheKey;
    },
    syncMode: "on-demand",
    queryFn: (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      const filters: {
        boardId?: string;
      } = {};
      for (const { field, operator, value } of parsed.filters) {
        if (operator === "eq") {
          const fieldName = field.join(".");

          if (fieldName === "boardId") {
            filters.boardId = value as string;
          }
        }
      }

      const boardId = filters.boardId;

      if (!boardId) {
        throw new Error("boardId is required");
      }

      return fetchRpc((rpc) => rpc.PostList({ boardId }), {
        signal: ctx.signal,
      }).then((data) => [...data]);
    },
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
  })
);

export const boardCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["board"],
    queryFn: async (args) =>
      fetchRpc((rpc) => rpc.BoardList(), { signal: args.signal }).then(
        (data) => [...data]
      ),
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newBoard } = transaction.mutations[0];
      await fetchRpc(
        (rpc) =>
          rpc.BoardCreate({
            id: newBoard.id,
            name: newBoard.name,
            visibility: newBoard.visibility,
          }),
        {}
      );
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedBoard } = transaction.mutations[0];
      await fetchRpc((rpc) => rpc.BoardDelete({ id: deletedBoard.id }), {});
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedBoard } = transaction.mutations[0];
      await fetchRpc(
        (rpc) =>
          rpc.BoardUpdate({
            id: updatedBoard.id,
            name: updatedBoard.name,
            visibility: updatedBoard.visibility,
          }),
        {}
      );
    },
  })
);

export const membershipCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["membership"],
    queryFn: async (args) =>
      fetchRpc((rpc) => rpc.MembershipList(), { signal: args.signal }).then(
        (data) => [...data]
      ),
    queryClient: TanstackQuery.getContext().queryClient,
    getKey: (item) => item.id,
  })
);
