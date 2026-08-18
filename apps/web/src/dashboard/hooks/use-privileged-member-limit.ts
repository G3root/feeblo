import { isPrivilegedRole } from "@feeblo/permissions";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { invitationsCollection, membersCollection } from "~/lib/collections";

import { useEntitlements } from "./use-entitlements";
import { useOrganizationId } from "./use-organization-id";

export const usePrivilegedMemberLimit = () => {
  const organizationId = useOrganizationId();
  const { entitlements } = useEntitlements();

  const membersQuery = useLiveQuery(
    (q) =>
      q
        .from({ member: membersCollection })
        .where(({ member }) => eq(member.organizationId, organizationId)),
    [organizationId]
  );

  const invitationsQuery = useLiveQuery(
    (q) =>
      q
        .from({ invitation: invitationsCollection })
        .where(({ invitation }) =>
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, "pending")
          )
        ),
    [organizationId]
  );

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
