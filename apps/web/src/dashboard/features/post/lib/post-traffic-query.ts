import { queryOptions } from "@tanstack/react-query";

import { fetchRpc } from "~/lib/runtime";

/**
 * The analytics tab's read, as query options.
 *
 * A plain TanStack Query rather than an atom because the tab owns a prefetch:
 * hovering or focusing the tab calls `prefetchQuery` with these same options,
 * and the panel's `useQuery` joins the in-flight request instead of starting a
 * second one. `signal` is wired through so closing the tab cancels a read that
 * has not finished.
 */
export const postTrafficQueryKey = (organizationId: string, postId: string) =>
  ["post-traffic", organizationId, postId] as const;

export const postTrafficQueryOptions = ({
  organizationId,
  postId,
}: {
  readonly organizationId: string;
  readonly postId: string;
}) =>
  queryOptions({
    queryFn: ({ signal }) =>
      fetchRpc((rpc) => rpc.GetPostTraffic({ organizationId, postId }), {
        signal,
      }),
    queryKey: postTrafficQueryKey(organizationId, postId),
    staleTime: 60_000,
  });
