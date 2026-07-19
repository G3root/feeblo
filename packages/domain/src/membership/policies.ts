import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import { isPrivilegedMemberRole } from "../plan-entitlements";
import * as Policy from "../policy";
import { MembershipRepository } from "./repository";

type TIsNotMember = {
  organizationId: string;
  email: string;
};

type THasOtherOwners = {
  organizationId: string;
  memberId: string;
};

type TIsMember = {
  organizationId: string;
  memberId: string;
};

type TCanAssignRoleWithinPlan = {
  organizationId: string;
  memberId: string;
  role: "owner" | "admin" | "member";
};

type TCanInviteRoleWithinPlan = {
  organizationId: string;
  role: string;
};

type TCanChangeRoleWithinPlan = {
  organizationId: string;
  currentRole: string;
  newRole: string;
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
};

const makeMembershipPolicy = Effect.gen(function* () {
  const repository = yield* MembershipRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const isNotMember = (args: TIsNotMember) =>
    repository
      .findMemberByEmailInOrg({
        organizationId: args.organizationId,
        email: args.email,
      })
      .pipe(Effect.map(Option.isNone));

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

  const canAddPrivilegedRole = (organizationId: string) =>
    entitlementPolicy.canAssignPrivilegedRole({
      organizationId,
      privilegedRoleCount: Effect.gen(function* () {
        const privilegedMembersCount = yield* repository.countPrivilegedMembers(
          { organizationId }
        );
        const pendingPrivilegedInvitationsCount =
          yield* repository.countPendingPrivilegedInvitations({
            organizationId,
          });

        return privilegedMembersCount + pendingPrivilegedInvitationsCount;
      }),
    });

  const canInviteRoleWithinPlan = (args: TCanInviteRoleWithinPlan) =>
    isPrivilegedMemberRole(args.role)
      ? canAddPrivilegedRole(args.organizationId)
      : Effect.void;

  const canChangeRoleWithinPlan = (args: TCanChangeRoleWithinPlan) =>
    isPrivilegedMemberRole(args.newRole) &&
    !isPrivilegedMemberRole(args.currentRole)
      ? canAddPrivilegedRole(args.organizationId)
      : Effect.void;

  const canAssignRoleWithinPlan = (args: TCanAssignRoleWithinPlan) =>
    Effect.gen(function* () {
      const member = yield* repository.findMemberById({
        memberId: args.memberId,
        organizationId: args.organizationId,
      });

      if (Option.isNone(member)) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Member not found",
        });
      }

      yield* canChangeRoleWithinPlan({
        organizationId: args.organizationId,
        currentRole: member.value.role,
        newRole: args.role,
      });
    });

  const canCancelInvitation = (args: TCanCancelInvitation) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId)
    );

  const canRemoveMember = (args: TCanRemoveMember) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId),
      isMemberAlready(args),
      hasOtherOwners(args)
    );

  const canUpdateMemberRole = (args: TCanUpdateMemberRole) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId),
      isMemberAlready(args),
      hasOtherOwners(args)
    );

  return {
    isNotMember,
    isMember: isMemberAlready,
    canInviteRoleWithinPlan,
    canChangeRoleWithinPlan,
    canAssignRoleWithinPlan,
    canCancelInvitation,
    canRemoveMember,
    canUpdateMemberRole,
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
