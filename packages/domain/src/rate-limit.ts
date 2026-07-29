import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import { getClientIpFromHeaders } from "./client-ip";
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

export class RateLimitExceededError extends Schema.TaggedErrorClass<RateLimitExceededError>()(
  "RateLimitExceededError",
  {},
  { httpApiStatus: 429, identifier: "RateLimitExceededError" }
) {}

export class RateLimitUnavailableError extends Schema.TaggedErrorClass<RateLimitUnavailableError>()(
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
      defaultValue: () => ({ consume: () => Effect.void }),
    }
  );

export const makePublicRpcRateLimiter = ({
  clientIp,
  rateLimitService,
}: {
  readonly clientIp: string;
  readonly rateLimitService: RateLimitService["Service"];
}): PublicRpcRateLimiterService => ({
  consume: ({ name, level, limit, window }) => {
    const defaults = publicRpcLimits[level];

    return rateLimitService
      .consume({
        key: `public-rpc:${name}:${clientIp}`,
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
      ...(limit === undefined ? {} : { limit }),
      ...(window === undefined ? {} : { window }),
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
      Effect.provideService(
        effect,
        PublicRpcRateLimiter,
        makePublicRpcRateLimiter({
          clientIp: getClientIpFromHeaders(options.headers),
          rateLimitService,
        })
      )
    );
  })
);
