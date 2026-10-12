import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/** The organization's members. */
export function useOrgMembers(organizationId: string) {
  const { membersCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: ["org-members", membersCollection.id, organizationId],
    query: (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
  });
}
