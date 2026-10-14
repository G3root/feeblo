import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { PolicyDeniedError } from "./policy";
import {
  PublicRpcRateLimiter,
  type PublicRpcRateLimitOptions,
} from "./rate-limit";
import { surfaceRpcName, withSurfacePolicyAndRateLimit } from "./surface";

const limiter = (consumed: Array<PublicRpcRateLimitOptions>) =>
  Effect.provideService(PublicRpcRateLimiter, {
    consume: (options) =>
      Effect.sync(() => {
        consumed.push(options);
      }),
  });

describe("surfaceRpcName", () => {
  it("names the dashboard RPC without a suffix", () => {
    expect(surfaceRpcName("CommentDelete", "dashboard")).toBe("CommentDelete");
  });

  it("names the public RPC with the Public suffix", () => {
    expect(surfaceRpcName("CommentDelete", "public")).toBe(
      "CommentDeletePublic"
    );
  });
});

describe("withSurfacePolicyAndRateLimit", () => {
  // Handler shape: the gate wraps the body by direct call, the package's
  // `withRemapDbErrors` pipes outside it. `surface.ts` documents why the
  // gate cannot be a `pipe` step.

  it.effect("derives the public bucket name from the operation", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      yield* withSurfacePolicyAndRateLimit({
        level: "write",
        operation: "CommentDelete",
        surface: "public",
        policy: Effect.void,
      })(Effect.void).pipe(limiter(consumed));

      expect(consumed).toEqual([
        { level: "write", name: "CommentDeletePublic" },
      ]);
    })
  );

  it.effect("leaves a surface with no level untouched", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      const result = yield* withSurfacePolicyAndRateLimit({
        level: undefined,
        operation: "CommentDelete",
        surface: "dashboard",
        policy: Effect.void,
      })(Effect.succeed("kept")).pipe(limiter(consumed));

      expect(result).toBe("kept");
      expect(consumed).toEqual([]);
    })
  );

  it.effect("decides admission before spending budget", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      const exit = yield* withSurfacePolicyAndRateLimit({
        level: "write",
        operation: "CommentCreate",
        surface: "public",
        policy: Effect.fail(new PolicyDeniedError()),
      })(Effect.void).pipe(limiter(consumed), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(consumed).toEqual([]);
    })
  );

  it.effect("spends the budget once the policy passes", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      yield* withSurfacePolicyAndRateLimit({
        level: "write",
        operation: "CommentCreate",
        surface: "public",
        policy: Effect.void,
      })(Effect.void).pipe(limiter(consumed));

      expect(consumed).toEqual([
        { level: "write", name: "CommentCreatePublic" },
      ]);
    })
  );
});
