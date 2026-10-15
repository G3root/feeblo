import * as Effect from "effect/Effect";

import type { Policy } from "./policy";
import {
  type PublicRpcRateLimitLevel,
  type RateLimitError,
  withPublicRpcRateLimit,
} from "./rate-limit";
import {
  type RemapDbErrorsConfig,
  type RemappedDbError,
  InternalServerError,
  withRemapDbErrors,
} from "./rpc-errors";

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
 * One surface's half of a pair where the limiter applies. The level is
 * present, so `SurfaceEntry` widens the error channel with `RateLimitError`.
 */
export type LimitedSurfaceConfig<TArgs> = {
  readonly rateLimit: PublicRpcRateLimitLevel;
  readonly policy: (args: TArgs) => Policy<unknown, unknown>;
};

/**
 * One surface's half of a pair with no limiter at all. The absent level is a
 * type-level fact, so a handler on this surface is not typed as if it could
 * fail with `RateLimitError` and `RpcGroup.toLayer` accepts it.
 */
export type UnlimitedSurfaceConfig<TArgs> = {
  readonly rateLimit: undefined;
  readonly policy: (args: TArgs) => Policy<unknown, unknown>;
};

/** One surface's half of a pair: the limiter it spends and its policy. */
export type SurfaceConfig<TArgs> =
  | LimitedSurfaceConfig<TArgs>
  | UnlimitedSurfaceConfig<TArgs>;

/**
 * The operations of an RPC group that exist on both surfaces: a tag whose
 * `<Tag>Public` twin the group also declares. A pair cannot be declared for a
 * dashboard-only RPC, and deleting the public twin in `rpcs.ts` breaks every
 * handler that pairs it, rather than surfacing at request time.
 */
export type PairedRpcTag<Tags extends string> = {
  [Tag in Tags]: `${Tag}Public` extends Tags ? Tag : never;
}[Tags];

/**
 * One operation's two surfaces, with the RPC tag the rate-limit bucket name
 * derives from. The tag is tied to the feature's group (`RpcTagsOf`), so a
 * rename in `rpcs.ts` cannot leave a handler naming a bucket after an RPC
 * that no longer exists.
 *
 * `defineSurfacePair` builds the value form of this declaration; the type is
 * what the not-yet-migrated handlers name in `satisfies`.
 */
export type SurfacePair<TArgs, Tags extends string = string> = {
  readonly operation: PairedRpcTag<Tags>;
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

type RateLimitErrorOf<Config> = Config extends {
  readonly rateLimit: PublicRpcRateLimitLevel;
}
  ? RateLimitError
  : never;

/** The channel `withRemapDbErrors` leaves behind. */
type RemappedError<E> = Exclude<E, RemappedDbError> | InternalServerError;

type PolicyRequirementOf<Config> = Config extends {
  readonly policy: (...args: never[]) => infer P;
}
  ? Effect.Services<P>
  : never;

/**
 * One surface's RPC entry, with the channels its surface config implies: the
 * limiter's `RateLimitError` only where a level exists, the policy's
 * `PolicyDeniedError` and services, and the db-error remap applied.
 */
export type SurfaceEntry<
  TArgs,
  Config extends SurfaceConfig<TArgs>,
  A,
  E,
  R,
> = (
  args: TArgs
) => Effect.Effect<
  A,
  RemappedError<E | RateLimitErrorOf<Config>>,
  R | PolicyRequirementOf<Config>
>;

/** The two RPC entries one pair's `handlers` builds from a single body. */
export type SurfaceHandlers<TArgs, Dashboard, Public, A, E, R> = {
  readonly dashboard: (
    args: TArgs
  ) => Effect.Effect<
    A,
    RemappedError<E | RateLimitErrorOf<Dashboard>>,
    R | PolicyRequirementOf<Dashboard>
  >;
  readonly public: (
    args: TArgs
  ) => Effect.Effect<
    A,
    RemappedError<E | RateLimitErrorOf<Public>>,
    R | PolicyRequirementOf<Public>
  >;
};

/**
 * Wraps one surface's body in its policy, then its limiter, then the
 * operation's db-error remap. The policy runs first so a denied caller never
 * spends budget; the remap is outermost so the policy's own repository probes
 * stay inside it, exactly as the hand-written pair did.
 */
const makeEntry = <TArgs, Config extends SurfaceConfig<TArgs>, A, E, R>(
  remap: RemapDbErrorsConfig,
  operation: string,
  config: Config,
  surface: Surface,
  body: (surface: Surface, args: TArgs) => Effect.Effect<A, E, R>
): SurfaceEntry<TArgs, Config, A, E, R> => {
  const name = surfaceRpcName(operation, surface);
  return (args: TArgs) => {
    // SAFETY: `config.policy` is the widened `Policy<unknown, unknown>` that
    // a generic `Config` exposes; the literal config at the
    // `defineSurfacePair` call site supplies the channels named here, exactly
    // as `Effect.andThen` and `withPublicRpcRateLimit` compute them.
    const admitted = (
      config.rateLimit === undefined
        ? Effect.andThen(config.policy(args), body(surface, args))
        : Effect.andThen(
            config.policy(args),
            withPublicRpcRateLimit({ level: config.rateLimit, name })(
              body(surface, args)
            )
          )
    ) as Effect.Effect<
      A,
      E | RateLimitErrorOf<Config>,
      R | PolicyRequirementOf<Config>
    >;

    return admitted.pipe(withRemapDbErrors(remap));
  };
};

/**
 * One operation's two surfaces as a value: the declaration, its literal
 * per-surface configs, and `handlers`, which builds both RPC entries from one
 * body. The body takes the surface for the branches that genuinely differ;
 * the policy, the limiter, and the bucket name all come from the pair, so a
 * handler cannot use another surface's config.
 */
export type SurfacePairRecord<
  TArgs,
  Tags extends string,
  Dashboard extends SurfaceConfig<TArgs>,
  Public extends SurfaceConfig<TArgs>,
> = {
  readonly _tag: "SurfacePair";
  readonly operation: PairedRpcTag<Tags>;
  readonly dashboard: Dashboard;
  readonly public: Public;
  readonly handlers: <A, E, R>(
    body: (surface: Surface, args: TArgs) => Effect.Effect<A, E, R>
  ) => SurfaceHandlers<TArgs, Dashboard, Public, A, E, R>;
};

/**
 * Builds the value form of a `SurfacePair`: the operation, the one db-error
 * remap both surfaces share, and each surface's literal config. Passing the
 * args type explicitly fixes the body's parameter, and `Tags` rejects an
 * operation whose public twin the group does not declare.
 */
export const defineSurfacePair =
  <TArgs, Tags extends string = string>() =>
  <
    const Dashboard extends SurfaceConfig<TArgs>,
    const Public extends SurfaceConfig<TArgs>,
  >(pair: {
    readonly operation: PairedRpcTag<Tags>;
    readonly remap: RemapDbErrorsConfig;
    readonly dashboard: Dashboard;
    readonly public: Public;
  }): SurfacePairRecord<TArgs, Tags, Dashboard, Public> => ({
    _tag: "SurfacePair",
    operation: pair.operation,
    dashboard: pair.dashboard,
    public: pair.public,
    handlers: (body) => ({
      dashboard: makeEntry(
        pair.remap,
        pair.operation,
        pair.dashboard,
        "dashboard",
        body
      ),
      public: makeEntry(
        pair.remap,
        pair.operation,
        pair.public,
        "public",
        body
      ),
    }),
  });

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
 *
 * Superseded by `defineSurfacePair().handlers`, which closes over the
 * surface instead of accepting its pieces as arguments; this export remains
 * for the handlers that have not migrated yet.
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
