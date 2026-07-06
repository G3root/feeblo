// credits: https://lucas-barake.github.io/building-a-composable-policy-system/
/** biome-ignore-all lint/style/useForOf: <explanation> */
/** biome-ignore-all lint/complexity/noBannedTypes: <explanation> */
// credits: https://github.com/CapSoftware/Cap/blob/main/packages/web-domain/src/Policy.ts

import type { NonEmptyReadonlyArray } from "effect/Array";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CurrentSession } from "./session-middleware";

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
  Effect.flatMap(CurrentSession, (user) =>
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
    const context = yield* Effect.context<CurrentSession>();
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
): Policy<E, R> => Effect.firstSuccessOf(policies);

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
