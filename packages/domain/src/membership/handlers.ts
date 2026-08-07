import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { MembershipPolicy } from "./policies";
import { MembershipRepository } from "./repository";
import { MembershipRpcs } from "./rpcs";
import type {
  TCancelInvitation,
  TOrganizationId,
  TRemoveMember,
  TUpdateMemberRole,
} from "./schema";

export const MembershipRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* MembershipRepository;
  const membershipPolicy = yield* MembershipPolicy;

  return {
    MembershipList: () => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* repository.findMembershipsByUserId({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Membership", "select"));
    },
    OrganizationMembersList: ({ organizationId }: TOrganizationId) =>
      repository
        .findOrganizationMembers({ organizationId })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          withRemapDbErrors("Membership", "select")
        ),
    OrganizationInvitationsList: ({ organizationId }: TOrganizationId) =>
      repository
        .findOrganizationInvitations({
          organizationId,
        })
        .pipe(
          // Pending invitations expose invitee emails + assigned roles, so the
          // same grant that can create/cancel them is required to read them.
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(organizationId),
              Policy.canPermission(organizationId, "members.invite")
            )
          ),
          withRemapDbErrors("Invitation", "select")
        ),
    OrganizationUpdateMemberRole: ({
      organizationId,
      memberId,
      role,
    }: TUpdateMemberRole) =>
      transaction(
        Effect.gen(function* () {
          yield* membershipPolicy.canAssignRoleWithinPlan({
            organizationId,
            memberId,
            role,
          });

          yield* membershipPolicy.canManageRole({
            organizationId,
            memberId,
            role,
          });

          yield* repository.updateMemberRole({
            organizationId,
            memberId,
            role,
          });
        })
      ).pipe(
        Policy.withPolicy(
          membershipPolicy.canUpdateMemberRole({
            organizationId,
            memberId,
            role,
          })
        ),
        withRemapDbErrors("Membership", "update")
      ),
    OrganizationRemoveMember: ({ organizationId, memberId }: TRemoveMember) =>
      transaction(
        Effect.gen(function* () {
          yield* membershipPolicy.canManageTarget({
            organizationId,
            memberId,
          });

          yield* repository.deleteMember({
            organizationId,
            memberId,
          });
        })
      ).pipe(
        Policy.withPolicy(
          membershipPolicy.canRemoveMember({ organizationId, memberId })
        ),
        withRemapDbErrors("Membership", "delete")
      ),
    OrganizationCancelInvitation: ({
      organizationId,
      invitationId,
    }: TCancelInvitation) =>
      repository
        .cancelInvitation({ organizationId, invitationId })
        .pipe(
          Policy.withPolicy(
            membershipPolicy.canCancelInvitation({ organizationId })
          ),
          withRemapDbErrors("Invitation", "update")
        ),
  };
});

export const MembershipRpcHandlers = MembershipRpcs.toLayer(
  MembershipRpcHandlersEffect
).pipe(
  Layer.provide(MembershipPolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(MembershipRepository.layer),
  Layer.provide(WorkspaceRepository.layer)
);
