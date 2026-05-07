// credits: https://lucas-barake.github.io/building-a-composable-policy-system/
/** biome-ignore-all lint/style/useForOf: <explanation> */
/** biome-ignore-all lint/complexity/noBannedTypes: <explanation> */
// credits: https://github.com/CapSoftware/Cap/blob/main/packages/web-domain/src/Policy.ts

import {
  type Cause,
  Context,
  Data,
  Effect,
  type Option,
  Result,
  Schema,
} from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { dual } from "effect/Function";

import { CurrentSession } from "./session-middleware";

const findError = <E>(
  self: Cause.Cause<E>
): Result.Result<E, Cause.Cause<never>> => {
  for (let i = 0; i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason?._tag === "Fail") {
      return Result.succeed(reason.error);
    }
  }
  return Result.fail(self as Cause.Cause<never>);
};

const catch_: {
  <E, B, E2, R2>(
    f: (e: NoInfer<E>) => Effect.Effect<B, E2, R2>
  ): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A | B, E2, R | R2>;
  <A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (e: NoInfer<E>) => Effect.Effect<B, E2, R2>
  ): Effect.Effect<A | B, E2, R | R2>;
} = dual(
  2,
  <A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (a: NoInfer<E>) => Effect.Effect<B, E2, R2>
  ): Effect.Effect<A | B, E2, R | R2> =>
    Effect.catchCauseFilter(self, findError as any, (e: any) => f(e)) as any
);

const firstSuccessOf = <Eff extends Effect.Effect<any, any, any>>(
  effects: Iterable<Eff>
): Effect.Effect<
  Effect.Success<Eff>,
  Effect.Error<Eff>,
  Effect.Services<Eff>
> =>
  Effect.suspend(() => {
    const iterator = effects[Symbol.iterator]();
    const state = iterator.next();
    if (state.done) {
      return Effect.die(new Error("Received an empty collection of effects"));
    }
    function loop(current: IteratorYieldResult<Eff>): Eff {
      const next = iterator.next();
      if (next.done) {
        return current.value;
      }
      return catch_(current.value, (_) => loop(next)) as any;
    }
    return loop(state);
  });

export type Policy<E = never, R = never> = Effect.Effect<
  void,
  PolicyDeniedError | E,
  CurrentSession | R
>;

export type PublicPolicy<E = never, R = never> = Effect.Effect<
  void,
  PolicyDeniedError | E,
  R
>;

export class PolicyDeniedError extends Schema.TaggedErrorClass<PolicyDeniedError>()(
  "PolicyDenied",
  { reason: Schema.optional(Schema.String) },
  { httpApiStatus: 403 }
) {}

/**
 * Creates a policy from a predicate function that evaluates the current user.
 */
export const policy = <E, R>(
  predicate: (
    user: CurrentSession["Service"]
  ) => Effect.Effect<boolean, E | DenyAccess, R>
): Policy<E, R> =>
  Effect.flatMap(CurrentSession.asEffect(), (user) =>
    Effect.flatMap(
      predicate(user).pipe(
        Effect.catchTag("DenyAccess", () => Effect.succeed(false))
      ),
      (result) => (result ? Effect.void : Effect.fail(new PolicyDeniedError()))
    )
  ) as Policy<E, R>;

/**
 * Creates a policy from a predicate function that may evaluate the current user,
 * or None if there isn't one.
 */
export const publicPolicy = <E, R>(
  predicate: (
    user: Option.Option<CurrentSession["Service"]>
  ) => Effect.Effect<boolean, E, R>
): PublicPolicy<E, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const user = Context.getOption(context, CurrentSession);

    return yield* Effect.flatMap(predicate(user), (result) =>
      result ? Effect.void : Effect.fail(new PolicyDeniedError())
    );
  }) as PublicPolicy<E, R>;

export class DenyAccess extends Data.TaggedError("DenyAccess")<{}> {}

/**
 * Applies a policy as a pre-check to an effect.
 * If the policy fails, the effect will fail with Forbidden.
 */
export const withPolicy =
  <E, R>(policy: Policy<E, R>) =>
  <A, E2, R2>(self: Effect.Effect<A, E2, R2>) =>
    Effect.andThen(policy, self);

/**
 * Applies a policy as a pre-check to an effect.
 * If the policy fails, the effect will fail with Forbidden.
 */
export const withPublicPolicy =
  <E, R>(policy: PublicPolicy<E, R>) =>
  <A, E2, R2>(self: Effect.Effect<A, E2, R2>) =>
    Effect.andThen(policy, self);

/**
 * Composes multiple policies with AND semantics - all policies must pass.
 * Returns a new policy that succeeds only if all the given policies succeed.
 */
export const all = <E, R>(
  ...policies: NonEmptyReadonlyArray<Policy<E, R>>
): Policy<E, R> =>
  Effect.all(policies, {
    concurrency: 1,
    discard: true,
  });

/**
 * Composes multiple policies with OR semantics - at least one policy must pass.
 * Returns a new policy that succeeds if any of the given policies succeed.
 */
export const any = <E, R>(
  ...policies: NonEmptyReadonlyArray<Policy<E, R>>
): Policy<E, R> => firstSuccessOf(policies);

export const hasMembership = (organizationId: string): Policy =>
  policy((user) => Effect.succeed(isMember(user, organizationId)));

export const isMember = (
  session: CurrentSession["Service"],
  organizationId: string
) =>
  session.memberships.some(
    (membership) => membership.organizationId === organizationId
  );

export const getMembership = (
  session: CurrentSession["Service"],
  organizationId: string
) =>
  session.memberships.find(
    (membership) => membership.organizationId === organizationId
  );

export const hasOrganizationRole = (
  organizationId: string,
  role: "owner" | "admin" | "member"
): Policy =>
  policy((user) =>
    Effect.succeed(
      user.memberships.some(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.role === role
      )
    )
  );
