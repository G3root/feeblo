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
  })
);
