import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
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
    ListMemberships: () => {
      return Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* repository.findMembershipsByUserId({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Membership", "select"));
    },
    ListOrganizationMembers: ({ organizationId }: TOrganizationId) =>
      repository
        .findOrganizationMembers({ organizationId })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(organizationId)),
          withRemapDbErrors("Membership", "select")
        ),
    ListOrganizationInvitations: ({ organizationId }: TOrganizationId) =>
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
    // A role change moves nobody in or out of the workspace, so it is not the
    // plan's business: the member allowance counts people, not privileges.
    // Only the rank rules (`canManageRole`) decide who may promote whom.
    UpdateOrganizationMemberRole: ({
      organizationId,
      memberId,
      role,
    }: TUpdateMemberRole) =>
      membershipPolicy
        .canManageRole({
          organizationId,
          memberId,
          role,
        })
        .pipe(
          Effect.andThen(
            repository.updateMemberRole({
              organizationId,
              memberId,
              role,
            })
          ),
          Policy.withPolicy(
            membershipPolicy.canUpdateMemberRole({
              organizationId,
              memberId,
              role,
            })
          ),
          withRemapDbErrors("Membership", "update")
        ),
    RemoveOrganizationMember: ({ organizationId, memberId }: TRemoveMember) =>
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
    CancelOrganizationInvitation: ({
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
  Layer.provide(MembershipRepository.layer)
);
