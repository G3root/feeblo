import { eq, useLiveQuery } from "@tanstack/react-db";

import { membersCollection } from "~/lib/collections";

/** The organization's members. */
export function useOrgMembers(organizationId: string) {
  return useLiveQuery({
    queryKey: ["org-members", membersCollection.id, organizationId],
    query: (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
  });
}
