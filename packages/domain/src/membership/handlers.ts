import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
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
            Effect.gen(function* () {
              const session = yield* CurrentSession;
              const audit = yield* AuditLogRecorder;
              // The previous role is the half of the diff the update no longer
              // knows, and the audit entry is only honest if it is read in the
              // same transaction as the write.
              yield* transaction(
                Effect.gen(function* () {
                  // Locked, so a concurrent role change cannot be read as
                  // the previous one and make the entry claim a transition
                  // that never happened.
                  const previous = yield* repository.findMemberByIdForUpdate({
                    memberId,
                    organizationId,
                  });

                  yield* repository.updateMemberRole({
                    organizationId,
                    memberId,
                    role,
                  });

                  if (Option.isNone(previous)) {
                    return;
                  }

                  yield* audit.record({
                    organizationId,
                    actor: actorFromSession(session, organizationId),
                    source: "dashboard",
                    action: "member.role_changed",
                    resourceId: memberId,
                    affectedUserId: previous.value.userId,
                    changes: {
                      fields: ["role"],
                      before: { role: previous.value.role },
                      after: { role },
                    },
                  });
                })
              );
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
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* membershipPolicy.canManageTarget({
              organizationId,
              memberId,
            });

            // Read before the delete: the row that ties the membership to a
            // person is gone afterwards, and the entry has to name who left.
            const target = yield* repository.findMemberById({
              memberId,
              organizationId,
            });

            yield* repository.deleteMember({
              organizationId,
              memberId,
            });

            if (Option.isNone(target)) {
              return;
            }

            yield* audit.record({
              organizationId,
              actor: actorFromSession(session, organizationId),
              source: "dashboard",
              action: "member.removed",
              resourceId: memberId,
              affectedUserId: target.value.userId,
            });
          })
        );
      }).pipe(
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
  Layer.provide(MembershipRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);
