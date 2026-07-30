import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import * as RateLimit from "./rate-limit";
import { RateLimitService } from "./rate-limit/service";

describe("publicRpc", () => {
  it("limits each client and RPC independently", async () => {
    const program = Effect.gen(function* () {
      yield* Effect.all(
        Array.from({ length: 60 }, () =>
          RateLimit.publicRpc({
            name: "PostListPublic",
            level: "read",
            limit: 60,
          })
        ),
        { concurrency: 1, discard: true }
      );

      const error = yield* Effect.flip(
        RateLimit.publicRpc({
          name: "PostListPublic",
          level: "read",
          limit: 60,
        })
      );

      yield* RateLimit.publicRpc({
        name: "BoardListPublic",
        level: "read",
        limit: 60,
      });

      const secondClientSucceeded = yield* RateLimit.publicRpc({
        name: "PostListPublic",
        level: "read",
        limit: 60,
      }).pipe(
        Effect.provideServiceEffect(
          RateLimit.PublicRpcRateLimiter,
          RateLimitService.use((rateLimitService) =>
            Effect.succeed(
              RateLimit.makePublicRpcRateLimiter({
                clientIp: "203.0.113.2",
                rateLimitService,
              })
            )
          )
        ),
        Effect.as(true)
      );

      return { error, secondClientSucceeded };
    });

    const { error, secondClientSucceeded } = await Effect.runPromise(
      program.pipe(
        Effect.provideServiceEffect(
          RateLimit.PublicRpcRateLimiter,
          RateLimitService.use((rateLimitService) =>
            Effect.succeed(
              RateLimit.makePublicRpcRateLimiter({
                clientIp: "203.0.113.1",
                rateLimitService,
              })
            )
          )
        ),
        Effect.provide(RateLimitService.layerMemory)
      )
    );

    expect(error._tag).toBe("RateLimitExceededError");
    expect(secondClientSucceeded).toBe(true);
  });

  it("uses named level defaults when no override is supplied", async () => {
    const program = Effect.gen(function* () {
      const rateLimitService = yield* RateLimitService;
      const limiter = RateLimit.makePublicRpcRateLimiter({
        clientIp: "198.51.100.1",
        rateLimitService,
      });

      return yield* Effect.gen(function* () {
        yield* Effect.all(
          Array.from({ length: 5 }, () =>
            RateLimit.publicRpc({
              name: "PostCreatePublic",
              level: "expensive",
            })
          ),
          { concurrency: 1, discard: true }
        );

        return yield* Effect.flip(
          RateLimit.publicRpc({
            name: "PostCreatePublic",
            level: "expensive",
          })
        );
      }).pipe(Effect.provideService(RateLimit.PublicRpcRateLimiter, limiter));
    }).pipe(Effect.provide(RateLimitService.layerMemory));

    const error = await Effect.runPromise(program);

    expect(error._tag).toBe("RateLimitExceededError");
  });
});
