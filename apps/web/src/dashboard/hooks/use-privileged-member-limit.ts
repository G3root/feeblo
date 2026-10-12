import { isPrivilegedRole } from "@feeblo/permissions";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";

import { useEntitlements } from "./use-entitlements";
import { useOrgInvitations } from "./use-org-invitations";
import { useOrgMembers } from "./use-org-members";
import { useOrganizationId } from "./use-organization-id";

/**
 * Privileged-member seat usage for the current organization.
 *
 * Both queries come from the shared org hooks, so the members page and the
 * invite form read the same live queries (and the same explicit keys).
 */
export const usePrivilegedMemberLimit = () => {
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

  const privilegedMemberCount = (membersQuery.data ?? []).filter((member) =>
    isPrivilegedRole(member.role.split(",")[0] ?? "")
  ).length;

  const pendingPrivilegedInvitationsCount = (
    invitationsQuery.data ?? []
  ).filter((invitation) => isPrivilegedRole(invitation.role ?? "")).length;

  const limit = entitlements.limits.privilegedMembers;
  const atLimit =
    membersQuery.isLoading ||
    invitationsQuery.isLoading ||
    (limit !== null &&
      privilegedMemberCount + pendingPrivilegedInvitationsCount >= limit);

  return {
    atLimit,
    limit,
    privilegedMemberCount,
  };
};
