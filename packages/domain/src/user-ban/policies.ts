import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { CurrentSession } from "../session-middleware";
import { UserBanRepository, type UserBanLookup } from "./repository";
import { PARTICIPATION_BANNED_REASON } from "./schema";

/**
 * The admission rule that keeps a banned end user out of self-service writes.
 *
 * It is a policy rather than a check inside each write so the refusal lands
 * before the write's transaction, is typed as the same `PolicyDenied` every
 * other refusal is, and is visible in the RPC contract next to the rate limit.
 * The public halves of the post, comment, vote, reaction, and subscription
 * pairs compose it; staff bypass it because banning a member is not a
 * moderation tool.
 */
const makeParticipationPolicy = Effect.gen(function* () {
  const repository = yield* UserBanRepository;

  const canSubjectParticipate = (input: UserBanLookup) =>
    repository.isMember(input).pipe(
      Effect.flatMap((member) =>
        member
          ? // The widget has no session to run `canParticipate`'s membership
            // check on. A contact linked to a member, or an address that
            // belongs to one, must bypass an address-only ban for the same
            // reason a member's session does.
            Effect.void
          : repository.isBanned(input).pipe(
              Effect.flatMap((banned) =>
                banned
                  ? Effect.fail(
                      new Policy.PolicyDeniedError({
                        reason: PARTICIPATION_BANNED_REASON,
                      })
                    )
                  : Effect.void
              )
            )
      )
    );

  /**
   * The session path: a member always passes, because staff are managed
   * through membership. Everyone else is checked by account and address.
   */
  const canParticipate = (organizationId: string) =>
    Effect.flatMap(CurrentSession, (session) =>
      Policy.isMember(session, organizationId)
        ? Effect.void
        : canSubjectParticipate({
            email: session.user.email,
            organizationId,
            userId: session.session.userId,
          })
    );

  return { canParticipate, canSubjectParticipate };
});

export class ParticipationPolicy extends Context.Service<ParticipationPolicy>()(
  "ParticipationPolicy",
  { make: makeParticipationPolicy }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(UserBanRepository.layer)
  );
}
