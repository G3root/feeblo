import type * as Effect from "effect/Effect";

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
 * One surface's half of a write: the rate limit it consumes (`undefined` when
 * the surface is unlimited) and the policy its handler applies. The record
 * `Record<Surface, SurfaceConfig<TArgs>>` is what makes a surface with no
 * entry a compile error.
 */
export type SurfaceConfig<TArgs> = {
  readonly rateLimit: PublicRpcRateLimitLevel | undefined;
  readonly policy: (args: TArgs) => Policy<unknown, unknown>;
};

/**
 * The RPC name of `operation` on `surface`. The public portal names every RPC
 * `<operation>Public`, so deriving the rate-limit bucket from the operation
 * keeps it from drifting from the RPC a handler answers.
 */
export const surfaceRpcName = (operation: string, surface: Surface): string =>
  surface === "public" ? `${operation}Public` : operation;

/**
 * Applies `surface`'s rate limit to a handler, with the bucket name derived
 * from the operation. A surface whose level is `undefined` passes through
 * untouched, and the conditional return type is what keeps the dashboard
 * RPC's error schema intact: a handler that cannot fail with `RateLimitError`
 * must not be typed as if it could, or `RpcGroup.toLayer` rejects it.
 */
export const withSurfaceRateLimit =
  <Level extends PublicRpcRateLimitLevel | undefined>(options: {
    readonly level: Level;
    readonly operation: string;
    readonly surface: Surface;
  }) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Level extends undefined
    ? Effect.Effect<A, E, R>
    : Effect.Effect<A, E | RateLimitError, R> =>
    // SAFETY: the conditional return type restates the two branches below;
    // `Level` is what selects the branch, so the assertion cannot lie.
    (options.level === undefined
      ? self
      : self.pipe(
          withPublicRpcRateLimit({
            level: options.level,
            name: surfaceRpcName(options.operation, options.surface),
          })
        )) as Level extends undefined
      ? Effect.Effect<A, E, R>
      : Effect.Effect<A, E | RateLimitError, R>;
