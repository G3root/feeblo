import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { type Policy, PolicyDeniedError } from "./policy";
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
 * `limit`/`window` override the level's preset in `publicRpcLimits` (e.g. the
 * suggestions endpoint's raised cap).
 */
export type LimitedSurfaceConfig<TArgs> = {
  readonly rateLimit: PublicRpcRateLimitLevel;
  readonly limit?: number;
  readonly window?: Duration.Input;
  readonly policy: (args: TArgs, surface: Surface) => Policy<unknown, unknown>;
};

/**
 * One surface's half of a pair with no limiter at all. The absent level is a
 * type-level fact, so a handler on this surface is not typed as if it could
 * fail with `RateLimitError` and `RpcGroup.toLayer` accepts it.
 */
export type UnlimitedSurfaceConfig<TArgs> = {
  readonly rateLimit: undefined;
  readonly policy: (args: TArgs, surface: Surface) => Policy<unknown, unknown>;
};

/**
 * One surface's half of a pair: the limiter it spends and its policy factory,
 * which the entry's surface is passed to. Halves whose admissions differ only
 * by `source` share one closure, so the policy can never describe a surface
 * other than the one its entry answers.
 */
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

/** The typed failures the literal config's policy factory can raise. */
type PolicyErrorOf<Config> = Config extends {
  readonly policy: (...args: never[]) => infer P;
}
  ? Effect.Error<P>
  : never;

/**
 * The entry's error channel before the remap's replacement: the body's own
 * failures, the policy factory's own (`PolicyDeniedError` admission
 * inclusive), and the limiter's conditional. A half without a level carries
 * no `RateLimitError`, and the remap excludes every db-family error and
 * replaces it with the operation's vocabulary.
 */
type UnremappedEntryError<Config, E> =
  | E
  | PolicyDeniedError
  | PolicyErrorOf<Config>
  | RateLimitErrorOf<Config>;

/** The channel `withRemapDbErrors` leaves behind for `UniqueViolationError`. */
type RemappedError<E, UniqueViolationError> =
  | Exclude<E, RemappedDbError>
  | InternalServerError
  | UniqueViolationError;

type PolicyRequirementOf<Config> = Config extends {
  readonly policy: (...args: never[]) => infer P;
}
  ? Effect.Services<P>
  : never;

/**
 * One surface's RPC entry, with the channels its surface config implies: the
 * limiter's `RateLimitError` only where a level exists, the policy factory's
 * own typed failures and services, and the db-error remap applied.
 */
export type SurfaceEntry<
  TArgs,
  Config extends SurfaceConfig<TArgs>,
  UniqueViolationError,
  A,
  E,
  R,
> = (
  args: TArgs
) => Effect.Effect<
  A,
  RemappedError<UnremappedEntryError<Config, E>, UniqueViolationError>,
  R | PolicyRequirementOf<Config>
>;

/** The two RPC entries one pair's `handlers` builds from a single body. */
export type SurfaceHandlers<
  TArgs,
  Dashboard,
  Public,
  UniqueViolationError,
  A,
  E,
  R,
> = {
  readonly dashboard: (
    args: TArgs
  ) => Effect.Effect<
    A,
    RemappedError<UnremappedEntryError<Dashboard, E>, UniqueViolationError>,
    R | PolicyRequirementOf<Dashboard>
  >;
  readonly public: (
    args: TArgs
  ) => Effect.Effect<
    A,
    RemappedError<UnremappedEntryError<Public, E>, UniqueViolationError>,
    R | PolicyRequirementOf<Public>
  >;
};

/**
 * Wraps one surface's body in its policy, then its limiter, then the
 * operation's db-error remap. The policy runs first so a denied caller never
 * spends budget; the remap is outermost so the policy's own repository probes
 * stay inside it, exactly as the hand-written pair did.
 *
 * A policy's typed failures reach `UnremappedEntryError` (its
 * `PolicyDeniedError` admission inclusive), and the remap excludes and
 * replaces the db-family members. Passing `surface` to the factory keeps the
 * policy's `source` welded to the entry that answers it.
 */
const makeEntry = <
  TArgs,
  Config extends SurfaceConfig<TArgs>,
  UniqueViolationError,
  A,
  E,
  R,
>(
  remap: RemapDbErrorsConfig<UniqueViolationError>,
  operation: string,
  config: Config,
  surface: Surface,
  body: (surface: Surface, args: TArgs) => Effect.Effect<A, E, R>
): SurfaceEntry<TArgs, Config, UniqueViolationError, A, E, R> => {
  const name = surfaceRpcName(operation, surface);
  return (args: TArgs) => {
    // SAFETY: once `Config` crosses makeEntry's generic boundary, TS reads
    // its members through the widened `SurfaceConfig` constraint, so every
    // channel on the composition below is unknowable to TS even though the
    // literal config at the call site decides them. The convergence — the
    // assertion onto the declared `UnremappedEntryError` — is what lets
    // callers see the declared channels instead; the runtime contract it
    // rests on (a policy only fails with PolicyDeniedError or db errors the
    // remap catches) is what surface.test.ts pins per surface.
    /* oxlint-disable effecttsgo/any-unknown-in-error-context -- the widened-constraint channels converge here; see the SAFETY comment */
    const composed =
      config.rateLimit === undefined
        ? Effect.andThen(config.policy(args, surface), body(surface, args))
        : Effect.andThen(
            config.policy(args, surface),
            withPublicRpcRateLimit({
              level: config.rateLimit,
              name,
              ...(config.limit === undefined
                ? undefined
                : { limit: config.limit }),
              ...(config.window === undefined
                ? undefined
                : { window: config.window }),
            })(body(surface, args))
          );

    // SAFETY: the composition above is unknowable to TS once `Config`
    // crosses makeEntry's generic boundary — TS reads `config.policy` through
    // the widened `SurfaceConfig` constraint, while the literal config at the
    // call site decides the real channels. This assertion converges what the
    // constraint widened onto the declared `UnremappedEntryError`; the
    // runtime contract it rests on — a policy only fails with
    // PolicyDeniedError or db errors the remap catches — is what
    // surface.test.ts pins per surface.
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- the SAFETY comment above states the invariant the assertion converges to.
    const admitted = composed as Effect.Effect<
      A,
      UnremappedEntryError<Config, E>,
      R | PolicyRequirementOf<Config>
    >;
    /* oxlint-enable effecttsgo/any-unknown-in-error-context */

    // Explicit type arguments on direct application, not `pipe`: an
    // overloaded helper's curried form cannot carry the generic channels
    // through its first call, and `pipe`'s overload resolution loses the
    // conditional member of the error channel at the boundary. The one
    // `RemappedDbErrorsConfig` overload is `<R, E, A, UV>` over a plain
    // `Effect<R, E, A>` — success, error, requirements, in that order.
    return withRemapDbErrors<
      A,
      UnremappedEntryError<Config, E>,
      R | PolicyRequirementOf<Config>,
      UniqueViolationError
    >(remap)(admitted);
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
  UniqueViolationError = never,
> = {
  readonly _tag: "SurfacePair";
  readonly operation: PairedRpcTag<Tags>;
  readonly dashboard: Dashboard;
  readonly public: Public;
  readonly handlers: <A, E, R>(
    body: (surface: Surface, args: TArgs) => Effect.Effect<A, E, R>
  ) => SurfaceHandlers<TArgs, Dashboard, Public, UniqueViolationError, A, E, R>;
};

/**
 * Builds a surface pair as a value: the operation, the one db-error remap
 * both surfaces share, and each surface's literal config. Passing the args
 * type explicitly fixes the body's parameter, and `Tags` rejects an operation
 * whose public twin the group does not declare.
 */
export const defineSurfacePair =
  <TArgs, Tags extends string = string>() =>
  <
    const Dashboard extends SurfaceConfig<TArgs>,
    const Public extends SurfaceConfig<TArgs>,
    const UniqueViolationError = never,
  >(pair: {
    readonly operation: PairedRpcTag<Tags>;
    readonly remap: RemapDbErrorsConfig<UniqueViolationError>;
    readonly dashboard: Dashboard;
    readonly public: Public;
  }): SurfacePairRecord<
    TArgs,
    Tags,
    Dashboard,
    Public,
    UniqueViolationError
  > => ({
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
 * One operation's public-only entry as a value: the declaration, its config,
 * and `entry`, which builds the portal half from its own body. The
 * dashboard side is deliberately absent — the pair machinery exists for
 * operations whose two bodies match, and this exists for the rest, whose
 * portal half still declares against the registry (`Tags` rejects an
 * operation whose public twin the group does not declare, exactly as a pair
 * does).
 *
 * The composition is exactly a pair's: policy (or `Policy.allow` where no
 * admission is needed), then limiter, then body, db-error remap outermost;
 * the bucket name is derived from the operation, so it cannot drift from the
 * RPC a handler answers.
 */
export type PublicEntryRecord<
  TArgs,
  Tags extends string,
  Config extends SurfaceConfig<TArgs>,
  UniqueViolationError = never,
> = {
  readonly _tag: "PublicEntry";
  readonly operation: PairedRpcTag<Tags>;
  readonly config: Config;
  readonly entry: <A, E, R>(
    body: (args: TArgs) => Effect.Effect<A, E, R>
  ) => SurfaceEntry<TArgs, Config, UniqueViolationError, A, E, R>;
};

/**
 * Builds a public-only entry as a value. `Tags` rejects an operation whose
 * public twin the group does not declare, exactly as `defineSurfacePair`
 * does; an operation with no dashboard twin at all stays hand-written.
 */
export const definePublicEntry =
  <TArgs, Tags extends string = string>() =>
  <
    const Config extends SurfaceConfig<TArgs>,
    const UniqueViolationError = never,
  >(entry: {
    readonly operation: PairedRpcTag<Tags>;
    readonly remap: RemapDbErrorsConfig<UniqueViolationError>;
    readonly config: Config;
  }): PublicEntryRecord<TArgs, Tags, Config, UniqueViolationError> => ({
    _tag: "PublicEntry",
    operation: entry.operation,
    config: entry.config,
    entry: (body) =>
      makeEntry(
        entry.remap,
        entry.operation,
        entry.config,
        "public",
        (_surface, args) => body(args)
      ),
  });
