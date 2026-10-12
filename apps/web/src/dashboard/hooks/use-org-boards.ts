import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * The organization's boards in collection order.
 *
 * Consumers that need a different order sort locally; keeping one shape lets
 * the sidebar, board pickers, and dialogs share the same live query.
 */
export function useOrgBoards(organizationId: string) {
  const { boardCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: ["org-boards", boardCollection.id, organizationId],
    query: (q) =>
      q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId)),
  });
}
