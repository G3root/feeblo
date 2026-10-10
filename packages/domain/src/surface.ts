import * as Effect from "effect/Effect";

import type { Policy } from "./policy";
import {
  type PublicRpcRateLimitLevel,
  type RateLimitError,
  withPublicRpcRateLimit,
} from "./rate-limit";

/**
 * The transport a handler answers on. The dashboard is the session-
 * authenticated RPC surface; the public portal is the feedback-board and
 * widget surface, whose RPC names carry the `Public` suffix (see CONTEXT.md).
 *
 * A write that exists on both surfaces is implemented once and takes the
 * surface, so the pair cannot drift; the RPC names, their auth middleware,
 * and their error schemas stay separate in the feature's `rpcs.ts`.
 */
export type Surface = "dashboard" | "public";

/**
 * One surface's half of a pair: the rate limit it consumes (`undefined` when
 * the surface is unlimited) and the policy its handler applies. `SurfacePair`
 * requires both keys, so a surface with no entry is a compile error.
 */
export type SurfaceConfig<TArgs> = {
  readonly rateLimit: PublicRpcRateLimitLevel | undefined;
  readonly policy: (args: TArgs) => Policy<unknown, unknown>;
};

/**
 * One operation's two surfaces, with the RPC tag the rate-limit bucket name
 * derives from. The tag is tied to the feature's group (`RpcTagsOf`), so a
 * rename in `rpcs.ts` cannot leave a handler naming a bucket after an RPC
 * that no longer exists.
 */
export type SurfacePair<TArgs, Tag extends string = string> = {
  readonly operation: Tag;
  readonly dashboard: SurfaceConfig<TArgs>;
  readonly public: SurfaceConfig<TArgs>;
};

/**
 * The RPC name of `operation` on `surface`. The public portal names every RPC
 * `<operation>Public`, so deriving the rate-limit bucket from the operation
 * keeps it from drifting from the RPC a handler answers.
 */
export const surfaceRpcName = (operation: string, surface: Surface): string =>
  surface === "public" ? `${operation}Public` : operation;

/**
 * Applies `surface`'s policy, then its rate limit, to a handler body.
 *
 * Inside this helper the policy runs before the limiter, so admission is
 * decided first: a denied caller never spends budget, and only an admitted
 * caller can be limited. Pair handlers wrap it in the feature's
 * `withRemapDbErrors` so the policy's own repository probes stay inside the
 * db-error remapping, and they call it directly — not as a `pipe` step,
 * where the deferred level conditional degrades and rates both branches
 * into every surface. `surface.test.ts` pins that composition shape.
 *
 * The conditional is load-bearing but deliberately lives as a member of the
 * error channel, not as the channel's whole shape: a handler whose level is
 * `undefined` must not be typed as if it could fail with `RateLimitError`,
 * or `RpcGroup.toLayer` rejects it — while the least-conditional shape
 * survives direct instantiation, which the whole-type conditional did
 * not.
 */
export const withSurfacePolicyAndRateLimit =
  <
    Level extends PublicRpcRateLimitLevel | undefined,
    P extends Policy<unknown, unknown>,
  >(options: {
    readonly level: Level;
    readonly operation: string;
    readonly surface: Surface;
    readonly policy: P;
  }) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<
    A,
    E | Effect.Error<P> | (Level extends undefined ? never : RateLimitError),
    R | Effect.Services<P>
  > =>
    // SAFETY: the union-member conditional above restates the two runtime
    // branches `level` selects; the assertion restates what `Effect.andThen`
    // and `withPublicRpcRateLimit` compute against the widened constraint.
    (options.level === undefined
      ? Effect.andThen(options.policy, self)
      : Effect.andThen(
          options.policy,
          withPublicRpcRateLimit({
            level: options.level,
            name: surfaceRpcName(options.operation, options.surface),
          })(self)
        )) as Effect.Effect<
      A,
      E | Effect.Error<P> | (Level extends undefined ? never : RateLimitError),
      R | Effect.Services<P>
    >;
