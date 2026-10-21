import * as Permissions from "@feeblo/permissions";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { MembershipRepository } from "./repository";

type THasOtherOwners = {
  organizationId: string;
  memberId: string;
};

type TIsMember = {
  organizationId: string;
  memberId: string;
};

type TCanInviteWithinPlan = {
  organizationId: string;
};

type TCanCancelInvitation = {
  organizationId: string;
};

type TCanRemoveMember = {
  organizationId: string;
  memberId: string;
};

type TCanUpdateMemberRole = {
  organizationId: string;
  memberId: string;
  role: Permissions.Role;
};

/**
 * An actor may only manage a target ranked strictly below them. Rank comes
 * from the shared role hierarchy (`@feeblo/permissions`).
 */
const canManageMember = (
  actorRole: Permissions.Role,
  targetRole: Permissions.Role
): boolean => Permissions.compareRoles(targetRole, actorRole) === -1;

const makeMembershipPolicy = Effect.gen(function* () {
  const repository = yield* MembershipRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const isMemberAlready = (args: TIsMember) =>
    repository
      .findMemberById({
        memberId: args.memberId,
        organizationId: args.organizationId,
      })
      .pipe(Effect.map(Option.isSome));

  const hasOtherOwners = (args: THasOtherOwners) =>
    repository
      .findOwnersInOrg({
        organizationId: args.organizationId,
      })
      .pipe(
        Effect.map(EffectArray.filter((member) => member.id !== args.memberId)),
        Effect.map((members) => members.length > 0)
      );

  /**
   * An invitation is a future member, so it consumes a seat before anyone
   * accepts it. The role on the invitation is irrelevant: the plan counts
   * people with access to the workspace, not privileged people.
   */
  const canAddMember = (organizationId: string) =>
    entitlementPolicy.canAddMember({
      organizationId,
      memberCount: Effect.gen(function* () {
        const memberCount = yield* repository.countMembers({ organizationId });
        const pendingInvitationsCount =
          yield* repository.countPendingInvitations({ organizationId });

        return memberCount + pendingInvitationsCount;
      }),
    });

  const canInviteWithinPlan = (args: TCanInviteWithinPlan) =>
    canAddMember(args.organizationId);

  const canCancelInvitation = (args: TCanCancelInvitation) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.canPermission(args.organizationId, "members.invite")
    );

  const canManageTarget = (args: TCanRemoveMember) =>
    Policy.policy((session) =>
      Effect.gen(function* () {
        const actor = Policy.getMembership(session, args.organizationId);
        if (!actor) {
          return false;
        }

        const target = yield* repository.findMemberById({
          memberId: args.memberId,
          organizationId: args.organizationId,
        });
        if (Option.isNone(target)) {
          return false;
        }

        return canManageMember(actor.role, target.value.role);
      })
    );

  const canRemoveMember = (args: TCanRemoveMember) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.canPermission(args.organizationId, "members.remove"),
      isMemberAlready(args),
      hasOtherOwners(args)
    );

  const canManageRole = (args: TCanUpdateMemberRole) =>
    Policy.policy((session) =>
      Effect.gen(function* () {
        const actor = Policy.getMembership(session, args.organizationId);
        if (!actor) {
          return false;
        }

        const target = yield* repository.findMemberById({
          memberId: args.memberId,
          organizationId: args.organizationId,
        });
        if (Option.isNone(target)) {
          return false;
        }

        const newRank = Permissions.ROLE_RANK[args.role];

        return (
          canManageMember(actor.role, target.value.role) &&
          newRank <= Permissions.ROLE_RANK[actor.role]
        );
      })
    );

  const canUpdateMemberRole = (args: TCanUpdateMemberRole) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.canPermission(args.organizationId, "members.assign"),
      isMemberAlready(args),
      hasOtherOwners(args)
    );

  return {
    canInviteWithinPlan,
    canCancelInvitation,
    canRemoveMember,
    canUpdateMemberRole,
    canManageTarget,
    canManageRole,
  };
});

export class MembershipPolicy extends Context.Service<MembershipPolicy>()(
  "MembershipPolicy",
  {
    make: makeMembershipPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
