import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  isPrivilegedMemberRole,
  PLAN_ENTITLEMENTS,
} from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "../workspace/repository";
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
  const workspaceRepository = yield* WorkspaceRepository;

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

      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: args.organizationId,
      });
      const entitlements = PLAN_ENTITLEMENTS[planState.plan];

      if (entitlements.privilegedRoleLimit === null) {
        return;
      }

      const privilegedMembersCount = yield* repository.countPrivilegedMembers({
        organizationId: args.organizationId,
      });
      const pendingPrivilegedInvitationsCount =
        yield* repository.countPendingPrivilegedInvitations({
          organizationId: args.organizationId,
        });

      if (
        privilegedMembersCount + pendingPrivilegedInvitationsCount >=
        entitlements.privilegedRoleLimit
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${planState.plan} plan allows up to ${entitlements.privilegedRoleLimit} admin roles.`,
        });
      }
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
