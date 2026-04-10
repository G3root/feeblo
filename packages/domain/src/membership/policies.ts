import { Effect, Array as EffectArray, Option } from "effect";
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

const makeMembershipPolicy = Effect.gen(function* () {
  const repository = yield* MembershipRepository;

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

  return {
    isNotMember,
    isMember,
    hasOtherOwners: (args: THasOtherOwners) =>
      Policy.all(hasOtherOwners(args), isMember(args)),
  };
});

export class MembershipPolicy extends Effect.Service<MembershipPolicy>()(
  "MembershipPolicy",
  {
    effect: makeMembershipPolicy,
    dependencies: [MembershipRepository.Default],
  }
) {
  static readonly layer = this.Default;
}
