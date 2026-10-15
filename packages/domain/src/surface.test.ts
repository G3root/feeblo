import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { PolicyDeniedError } from "./policy";
import {
  PublicRpcRateLimiter,
  type PublicRpcRateLimitOptions,
  type RateLimitError,
} from "./rate-limit";
import {
  defineSurfacePair,
  type PairedRpcTag,
  surfaceRpcName,
} from "./surface";

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

/** The pair's args shape for the tests below. */
type TestArgs = { readonly id: string };

/** Only `ThingCreate` has a `ThingCreatePublic` twin in this union. */
type TestTags = "ThingCreate" | "ThingCreatePublic" | "ThingPin";

const pair = defineSurfacePair<TestArgs, TestTags>()({
  operation: "ThingCreate",
  remap: { action: "create", entity: "Thing" },
  dashboard: { rateLimit: undefined, policy: () => Effect.void },
  public: { rateLimit: "write", policy: () => Effect.void },
});

const entries = pair.handlers((_surface, _args) => Effect.succeed("kept"));

describe("defineSurfacePair", () => {
  it("keeps each surface's channels and the pair's args", () => {
    type DashboardError = Effect.Error<ReturnType<typeof entries.dashboard>>;
    type PublicError = Effect.Error<ReturnType<typeof entries.public>>;

    // The dashboard entry must not be typed as if it could fail with a
    // rate-limit error, or `RpcGroup.toLayer` rejects its RPC.
    expectTypeOf<
      Extract<DashboardError, RateLimitError>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<PublicError, RateLimitError>
    >().toEqualTypeOf<RateLimitError>();
    expectTypeOf<
      Parameters<typeof entries.public>[0]
    >().toEqualTypeOf<TestArgs>();
    expectTypeOf<PairedRpcTag<TestTags>>().toEqualTypeOf<"ThingCreate">();
  });

  it.effect("spends the public bucket derived from the operation", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      const result = yield* entries
        .public({ id: "thing-1" })
        .pipe(limiter(consumed));

      expect(result).toBe("kept");
      expect(consumed).toEqual([{ level: "write", name: "ThingCreatePublic" }]);
    })
  );

  it.effect("spends the budget before the body runs", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      const ordered = defineSurfacePair<TestArgs, TestTags>()({
        operation: "ThingCreate",
        remap: { action: "create", entity: "Thing" },
        dashboard: { rateLimit: undefined, policy: () => Effect.void },
        public: { rateLimit: "write", policy: () => Effect.void },
      });

      const result = yield* ordered
        .handlers((_surface, _args) =>
          Effect.sync(() => {
            order.push("body");
            return "kept";
          })
        )
        .public({ id: "thing-1" })
        .pipe(
          Effect.provideService(PublicRpcRateLimiter, {
            consume: ({ name }) =>
              Effect.sync(() => {
                order.push(`limit:${name}`);
              }),
          })
        );

      expect(result).toBe("kept");
      expect(order).toEqual(["limit:ThingCreatePublic", "body"]);
    })
  );

  it.effect("leaves the dashboard surface unthrottled", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];

      const result = yield* entries
        .dashboard({ id: "thing-1" })
        .pipe(limiter(consumed));

      expect(result).toBe("kept");
      expect(consumed).toEqual([]);
    })
  );

  it.effect("decides admission before spending budget", () =>
    Effect.gen(function* () {
      const consumed: Array<PublicRpcRateLimitOptions> = [];
      const bodyRan: Array<string> = [];
      const denied = defineSurfacePair<TestArgs, TestTags>()({
        operation: "ThingCreate",
        remap: { action: "create", entity: "Thing" },
        dashboard: { rateLimit: undefined, policy: () => Effect.void },
        public: {
          rateLimit: "write",
          policy: () => Effect.fail(new PolicyDeniedError()),
        },
      });

      const exit = yield* denied
        .handlers((_surface, _args) =>
          Effect.sync(() => {
            bodyRan.push("body");
          })
        )
        .public({ id: "thing-1" })
        .pipe(limiter(consumed), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(consumed).toEqual([]);
      expect(bodyRan).toEqual([]);
    })
  );

  it.effect("passes the surface each entry is bound to into the body", () =>
    Effect.gen(function* () {
      const surfaceOf = pair.handlers((surface, _args) =>
        Effect.succeed(surface)
      );

      expect(yield* surfaceOf.dashboard({ id: "thing-1" })).toBe("dashboard");
      expect(yield* surfaceOf.public({ id: "thing-1" })).toBe("public");
    })
  );
});
