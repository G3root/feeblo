import { useAuthState } from "@feeblo/web-shared/use-auth-state";

/**
 * The signed-in user's `member` row for one workspace, or `undefined`.
 *
 * The board needs it for the "Assigned to me" view and for the assignee
 * filter's "me" entry. It is read from the session's `memberships` rather than
 * matched by user id against the members collection: the session is
 * authoritative about which member row belongs to this user, and a
 * user-id → member-row guess would also match a member whose row arrived from
 * another workspace's overfetch.
 */
export function useCurrentMemberId(organizationId: string): string | undefined {
  const { data: session } = useAuthState();

  return session?.memberships.find(
    (membership) => membership.organizationId === organizationId
  )?.membershipId;
}
