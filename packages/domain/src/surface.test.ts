import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  PublicRpcRateLimiter,
  type PublicRpcRateLimitOptions,
} from "./rate-limit";
import {
  surfaceRpcName,
  withSurfacePolicy,
  withSurfaceRateLimit,
} from "./surface";

describe("withSurfaceRateLimit", () => {
  it.effect("derives the public bucket name from the operation", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      yield* Effect.void.pipe(
        withSurfaceRateLimit({
          level: "write",
          operation: "CommentDelete",
          surface: "public",
        }),
        Effect.provideService(PublicRpcRateLimiter, {
          consume: (options) =>
            Effect.sync(() => {
              consumed.push(options);
            }),
        })
      );

      expect(consumed).toEqual([
        { level: "write", name: "CommentDeletePublic" },
      ]);
    })
  );

  it.effect("leaves a surface with no level untouched", () =>
    Effect.gen(function* () {
      const result = yield* Effect.succeed("kept").pipe(
        withSurfaceRateLimit({
          level: undefined,
          operation: "CommentDelete",
          surface: "dashboard",
        })
      );

      expect(result).toBe("kept");
    })
  );

  it("names the dashboard RPC without a suffix", () => {
    expect(surfaceRpcName("CommentDelete", "dashboard")).toBe("CommentDelete");
  });

  it("names the public RPC with the Public suffix", () => {
    expect(surfaceRpcName("CommentDelete", "public")).toBe(
      "CommentDeletePublic"
    );
  });
});

describe("withSurfacePolicy", () => {
  it.effect("runs the policy before the handler", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];

      const result = yield* Effect.sync(() => {
        order.push("body");
        return "kept";
      }).pipe(
        withSurfacePolicy(
          Effect.sync(() => {
            order.push("policy");
          })
        )
      );

      expect(order).toEqual(["policy", "body"]);
      expect(result).toBe("kept");
    })
  );
});
