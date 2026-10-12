import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * The organization's tags. Consumers that need a different order sort
 * locally; the board filter, post tag field, and settings table all read the
 * same live query.
 */
export function useOrgTags(organizationId: string) {
  const { tagCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: ["org-tags", tagCollection.id, organizationId],
    query: (q) =>
      q
        .from({ tag: tagCollection })
        .where(({ tag }) => eq(tag.organizationId, organizationId)),
  });
}
