import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { invitationsCollection } from "~/lib/collections";

/**
 * The organization's pending invitations. `enabled` carries the policy gate
 * (members.invite) so the query stays disabled until the caller may list
 * them; it is part of the key because it changes the query shape.
 */
export function useOrgInvitations({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  return useLiveQuery({
    queryKey: [
      "org-invitations",
      invitationsCollection.id,
      organizationId,
      enabled,
    ],
    query: (q) => {
      if (!enabled) {
        return undefined;
      }
      return q
        .from({ invitation: invitationsCollection })
        .where(({ invitation }) =>
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, "pending")
          )
        );
    },
  });
}
