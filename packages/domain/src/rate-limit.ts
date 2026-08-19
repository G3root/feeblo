import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import {
  ClientIp,
  type ClientIpValue,
  getClientIpFromHeaders,
} from "./client-ip";
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
    const defaults = publicRpcLimits[level];
    const isUnavailable = clientIp._tag !== "ClientIpAddress";

    const consumeEffect = rateLimitService
      .consume({
        key: `public-rpc:${name}:${
          clientIp._tag === "ClientIpAddress" ? clientIp.address : "unavailable"
        }`,
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

    // Shared "unavailable" bucket is a DoS vector when remoteAddress is
    // missing or proxy trust is misconfigured. Emit a warning so operators
    // can detect a spike and fix proxy config; do not block the request.
    return isUnavailable
      ? consumeEffect.pipe(
          Effect.tap(() =>
            Effect.logWarning(
              "Public RPC rate-limit used shared unavailable bucket — check ClientIp proxy trust / remoteAddress"
            ).pipe(Effect.annotateLogs({ rpc: name }))
          )
        )
      : consumeEffect;
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

    return PublicRpcRateLimitMiddleware.of((effect, options) =>
      Effect.gen(function* () {
        // Prefer the peer-anchored client IP provided by the global HTTP
        // middleware. Only fall back to the headers when that is not
        // installed; without a TCP peer, getClientIpFromHeaders cannot
        // validate the provenance of any forwarded header and returns the
        // shared "unknown" bucket rather than accepting spoofable values.
        const clientIpOption = yield* Effect.serviceOption(ClientIp);
        const clientIp = Option.isSome(clientIpOption)
          ? clientIpOption.value
          : getClientIpFromHeaders(Headers.fromInput(options.headers));

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
