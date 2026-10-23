import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";

import { useEntitlements } from "./use-entitlements";
import { useOrgInvitations } from "./use-org-invitations";
import { useOrgMembers } from "./use-org-members";
import { useOrganizationId } from "./use-organization-id";

/**
 * Member seat usage for the current organization.
 *
 * Every member counts, whatever their role: the plan limits how many people
 * have access to the workspace, not how many of them are privileged. A pending
 * invitation holds a seat before it is accepted, so an invite cannot reserve
 * capacity the plan does not have. End users are not members and are unlimited
 * on every plan.
 *
 * Both queries come from the shared org hooks, so the members page and the
 * invite form read the same live queries (and the same explicit keys).
 */
export const useMemberLimit = () => {
  const organizationId = useOrganizationId();

  const { allowed: canListInvitations, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "members.invite")
  );
  const { entitlements } = useEntitlements();

  const membersQuery = useOrgMembers(organizationId);
  const invitationsQuery = useOrgInvitations({
    organizationId,
    enabled: !isPolicyPending && canListInvitations,
  });

  const memberCount = (membersQuery.data ?? []).length;
  const pendingInvitationCount = (invitationsQuery.data ?? []).length;

  const limit = entitlements.limits.members;
  const atLimit =
    membersQuery.isLoading ||
    invitationsQuery.isLoading ||
    (limit !== null && memberCount + pendingInvitationCount >= limit);

  return {
    atLimit,
    limit,
    memberCount,
  };
};
