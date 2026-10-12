import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * The organization's post statuses in lane order.
 *
 * One live query shape for every status consumer in the dashboard, so the
 * result is shared and the explicit `queryKey` keeps the board surface and
 * post detail fields from rebuilding and hashing the IR on each render.
 */
export function useOrgPostStatuses(organizationId: string) {
  const { postStatusCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: ["org-post-statuses", postStatusCollection.id, organizationId],
    query: (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        )
        .orderBy(({ postStatus }) => postStatus.orderIndex, "asc"),
  });
}
