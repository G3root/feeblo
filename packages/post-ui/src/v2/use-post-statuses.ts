import { eq, useLiveQuery } from "@tanstack/react-db";

import { usePostCollections } from "./providers/post-collections-provider";

/**
 * The organization's post statuses for the shared post surfaces.
 *
 * Reads the provider's collection, so the dashboard portal and the public
 * board each get their own instance with the same query shape and key.
 */
export function usePostStatuses() {
  const {
    collections: { postStatusCollection },
    organizationId,
  } = usePostCollections();

  return useLiveQuery({
    queryKey: ["post-statuses", postStatusCollection.id, organizationId],
    query: (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
  });
}
