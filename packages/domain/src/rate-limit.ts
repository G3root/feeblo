import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import { ClientIp, type ClientIpValue } from "./client-ip";
import { RateLimitService } from "./rate-limit/service";

export const publicRpcLimits = {
  read: { limit: 120, window: "1 minute" },
  write: { limit: 20, window: "1 minute" },
  expensive: { limit: 5, window: "1 minute" },
} as const satisfies Record<
  string,
  { readonly limit: number; readonly window: Duration.Input }
>;

export type PublicRpcRateLimitLevel = keyof typeof publicRpcLimits;

export interface PublicRpcRateLimitOptions {
  readonly level: PublicRpcRateLimitLevel;
  readonly limit?: number;
  readonly name: string;
  readonly window?: Duration.Input;
}

export class RateLimitExceededError extends Schema.TaggedError<RateLimitExceededError>()(
  "RateLimitExceededError",
  {},
  { httpApiStatus: 429, identifier: "RateLimitExceededError" }
) {}

export class RateLimitUnavailableError extends Schema.TaggedError<RateLimitUnavailableError>()(
  "RateLimitUnavailableError",
  {},
  { httpApiStatus: 503, identifier: "RateLimitUnavailableError" }
) {}

export const RateLimitErrors = Schema.Union([
  RateLimitExceededError,
  RateLimitUnavailableError,
]);

type RateLimitError = RateLimitExceededError | RateLimitUnavailableError;

interface PublicRpcRateLimiterService {
  readonly consume: (
    options: PublicRpcRateLimitOptions
  ) => Effect.Effect<void, RateLimitError>;
}

export const PublicRpcRateLimiter =
  Context.Reference<PublicRpcRateLimiterService>(
    "@feeblo/domain/PublicRpcRateLimiter",
    {
      // Handler unit tests call handlers without running RPC middleware.
      defaultValue: () => ({
        consume: ({ name }) =>
          Effect.logWarning(
            "Public RPC rate limit middleware is not installed"
          ).pipe(Effect.annotateLogs({ rpc: name })),
      }),
    }
  );

export const makePublicRpcRateLimiter = ({
  clientIp,
  rateLimitService,
}: {
  readonly clientIp: ClientIpValue;
  readonly rateLimitService: RateLimitService["Service"];
}): PublicRpcRateLimiterService => ({
  consume: ({ name, level, limit, window }) => {
    // Fail closed: without a ClientIpAddress the request cannot be assigned a
    // per-client bucket. The former shared "unavailable" bucket was a DoS
    // vector — a single client could exhaust the limit for everyone — so
    // reject before invoking RateLimitService.consume, matching the
    // middleware's onNone fail-closed behavior.
    if (clientIp._tag !== "ClientIpAddress") {
      return Effect.fail(new RateLimitUnavailableError());
    }

    const defaults = publicRpcLimits[level];
    return rateLimitService
      .consume({
        key: `public-rpc:${name}:${clientIp.address}`,
        limit: limit ?? defaults.limit,
        window: window ?? defaults.window,
      })
      .pipe(
        Effect.catchTag("RateLimiterError", (error) =>
          Effect.fail<RateLimitError>(
            error.reason._tag === "RateLimitExceeded"
              ? new RateLimitExceededError()
              : new RateLimitUnavailableError()
          )
        )
      );
  },
});

export type PublicRpcRateLimit = Effect.Effect<void, RateLimitError>;

export const publicRpc = ({
  name,
  level,
  limit,
  window,
}: PublicRpcRateLimitOptions): PublicRpcRateLimit =>
  PublicRpcRateLimiter.use((rateLimiter) =>
    rateLimiter.consume({
      name,
      level,
      ...(limit === undefined ? undefined : { limit }),
      ...(window === undefined ? undefined : { window }),
    })
  );

export const withPublicRpcRateLimit =
  (options: PublicRpcRateLimitOptions) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.andThen(publicRpc(options), self);

/**
 * Per-member rate limits for authenticated dashboard RPCs (see
 * plan-on-behalf.md, "Abuse and Cost Controls"). Unlike the public
 * helpers above these are keyed by the calling member, not the client IP:
 * dashboard RPCs always run under `AuthMiddleware`, so the member is the
 * stable abuse identity.
 *
 * - `contact-search`: the combobox debounces client-side (~200ms, so
 *   sustained typing peaks near 300 requests/minute); the cap sits above
 *   that with headroom for a cheap indexed query.
 * - `on-behalf-create`: deliberate admin writes (posts, voters, comments
 *   attributed to a customer); 60/minute is generous for bulk capture
 *   while bounding contact/shadow-user provisioning.
 */
const dashboardRateLimits = {
  "contact-search": { limit: 300, window: "1 minute" },
  "on-behalf-create": { limit: 60, window: "1 minute" },
} as const satisfies Record<
  string,
  { readonly limit: number; readonly window: Duration.Input }
>;

export type DashboardRateLimitName = keyof typeof dashboardRateLimits;

export const consumeDashboardRateLimit = (args: {
  /** Fully-qualified key including the member scope, e.g. `contact-search:{org}:{userId}`. */
  readonly key: string;
  readonly name: DashboardRateLimitName;
  /** Override for tests; production call sites always use the preset. */
  readonly limit?: number;
}): Effect.Effect<void, RateLimitError> =>
  Effect.gen(function* () {
    const rateLimitService = yield* Effect.serviceOption(RateLimitService);
    if (Option.isNone(rateLimitService)) {
      // Handler unit tests run without the rate-limit layer (same rationale
      // as `PublicRpcRateLimiter`'s defaultValue above): skip rather than
      // fail closed, so pure behavior tests need no limiter wiring.
      return;
    }
    const preset = dashboardRateLimits[args.name];
    return yield* rateLimitService.value
      .consume({
        key: args.key,
        limit: args.limit ?? preset.limit,
        window: preset.window,
      })
      .pipe(
        Effect.catchTag("RateLimiterError", (error) =>
          Effect.fail<RateLimitError>(
            error.reason._tag === "RateLimitExceeded"
              ? new RateLimitExceededError()
              : new RateLimitUnavailableError()
          )
        )
      );
  });

/**
 * Per-member abuse bound for on-behalf writes (posts, voter add/remove,
 * comments attributed to a customer; see plan-on-behalf.md, "Abuse and
 * Cost Controls"). Centralizes the `on-behalf-create:{org}:{userId}` key
 * so the five call sites cannot drift (wrong key or bucket name on the
 * next copy). Self-service paths never call this.
 */
export const consumeOnBehalfWriteLimit = (args: {
  readonly organizationId: string;
  readonly userId: string;
  /** Override for tests; production call sites always use the preset. */
  readonly limit?: number;
}): Effect.Effect<void, RateLimitError> =>
  consumeDashboardRateLimit({
    key: `on-behalf-create:${args.organizationId}:${args.userId}`,
    name: "on-behalf-create",
    ...(args.limit === undefined ? undefined : { limit: args.limit }),
  });

export class PublicRpcRateLimitMiddleware extends RpcMiddleware.Service<PublicRpcRateLimitMiddleware>()(
  "@feeblo/api/PublicRpcRateLimitMiddleware",
  {
    error: RateLimitErrors,
  }
) {}

export const PublicRpcRateLimitMiddlewareLive = Layer.effect(
  PublicRpcRateLimitMiddleware,
  Effect.gen(function* () {
    const rateLimitService = yield* RateLimitService;

    return PublicRpcRateLimitMiddleware.of((effect) =>
      Effect.gen(function* () {
        // Fail closed: without the global ClientIp middleware there is no
        // trustworthy per-request identity, so limits cannot be partitioned per
        // client. The former header fallback always produced the shared
        // "unavailable" bucket — `getClientIpFromHeaders` requires a TCP peer —
        // so every public request collapsed into one global bucket that a
        // single attacker could exhaust for everyone (or hide their own volume
        // in). Refuse the request instead; the composition root must install
        // `makeClientIpGlobalMiddleware` before the RPC route.
        const clientIp = yield* Option.match(
          yield* Effect.serviceOption(ClientIp),
          {
            onNone: () => Effect.fail(new RateLimitUnavailableError()),
            // Accept only a resolved ClientIpAddress; a ClientIpUnavailable
            // value (no peer) is rejected just like a missing service rather
            // than being routed to a shared bucket.
            onSome: (value) =>
              value._tag === "ClientIpAddress"
                ? Effect.succeed(value)
                : Effect.fail(new RateLimitUnavailableError()),
          }
        );

        return yield* Effect.provideService(
          effect,
          PublicRpcRateLimiter,
          makePublicRpcRateLimiter({
            clientIp,
            rateLimitService,
          })
        );
      })
    );
  })
);

/**
 * Per-client-IP rate limit for public HTTP (non-RPC) handlers, e.g. the
 * public email-subscription verify/unsubscribe links. Requires the global
 * {@link ClientIp} middleware and a {@link RateLimitService} to be installed
 * (both are provided by the server composition root).
 */
export const withPublicHttpRateLimit =
  (options: PublicRpcRateLimitOptions) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const clientIp = yield* ClientIp;
      const rateLimitService = yield* RateLimitService;

      return yield* Effect.provideService(
        effect.pipe(withPublicRpcRateLimit(options)),
        PublicRpcRateLimiter,
        makePublicRpcRateLimiter({
          clientIp,
          rateLimitService,
        })
      );
    });
