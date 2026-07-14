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

  const isMember = (args: TIsMember) =>
    repository
      .findMemberById({
        memberId: args.memberId,
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

  const canAssignRoleWithinPlan = (args: TCanAssignRoleWithinPlan) =>
    Effect.gen(function* () {
      const member = yield* repository.findMemberById({
        memberId: args.memberId,
      });

      if (Option.isNone(member)) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Member not found",
        });
      }

      if (
        !isPrivilegedMemberRole(args.role) ||
        isPrivilegedMemberRole(member.value.role)
      ) {
        return;
      }

      yield* entitlementPolicy.canAssignPrivilegedRole({
        organizationId: args.organizationId,
        privilegedRoleCount: Effect.gen(function* () {
          const privilegedMembersCount =
            yield* repository.countPrivilegedMembers({
              organizationId: args.organizationId,
            });
          const pendingPrivilegedInvitationsCount =
            yield* repository.countPendingPrivilegedInvitations({
              organizationId: args.organizationId,
            });

          return privilegedMembersCount + pendingPrivilegedInvitationsCount;
        }),
      });
    });

  return {
    isNotMember,
    isMember,
    hasOtherOwners: (args: THasOtherOwners) =>
      Policy.all(hasOtherOwners(args), isMember(args)),
    canAssignRoleWithinPlan,
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
