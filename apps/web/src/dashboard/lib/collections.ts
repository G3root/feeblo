import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import * as TanstackQuery from "~/integrations/tanstack-query/root-provider";
import { fetchRpc } from "./runtime";

export const postCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["post"],
    queryFn: async (args) =>
      fetchRpc((rpc) => rpc.PostList(), { signal: args.signal }).then(
        (data) => [...data]
      ),
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
