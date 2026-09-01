import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcMessage from "effect/unstable/rpc/RpcMessage";

import {
  makeClientIpGlobalMiddleware,
  parseClientIpProxyTrust,
} from "./client-ip";
import {
  PublicRpcRateLimitMiddleware,
  PublicRpcRateLimitMiddlewareLive,
  publicRpc,
  RateLimitUnavailableError,
} from "./rate-limit";
import { RateLimitService } from "./rate-limit/service";

const TestRpc = Rpc.make("ClientIpRateLimitTest", {
  success: Schema.String,
});

it.effect(
  "global client IP middleware gives public RPC limits distinct client keys",
  () => {
    const proxyTrustResult = parseClientIpProxyTrust({
      trustAllHeaders: true,
      trustedProxyCidrs: [],
    });
    if (proxyTrustResult._tag === "Failure") {
      return Effect.die(proxyTrustResult.failure);
    }

    const Route = HttpRouter.add("GET", "/rate-limit", (request) =>
      Effect.gen(function* () {
        const middleware = yield* PublicRpcRateLimitMiddleware;
        return yield* middleware(
          Effect.gen(function* () {
            yield* publicRpc({
              name: "ClientIpRateLimitIntegrationTest",
              level: "read",
              limit: 1,
            });
            return yield* new RateLimitUnavailableError();
          }),
          {
            client: new Rpc.ServerClient(1),
            requestId: RpcMessage.RequestId("client-ip-rate-limit-test"),
            rpc: TestRpc,
            payload: undefined,
            headers: request.headers,
          }
        ).pipe(
          Effect.as(HttpServerResponse.text("ok")),
          Effect.catchTag("RateLimitUnavailableError", () =>
            Effect.succeed(HttpServerResponse.text("ok"))
          )
        );
      }).pipe(
        Effect.catchTag("RateLimitExceededError", () =>
          Effect.succeed(HttpServerResponse.text("limited", { status: 429 }))
        ),
        Effect.catchCause(() =>
          Effect.succeed(HttpServerResponse.text("failed", { status: 500 }))
        )
      )
    );
    const RpcRateLimitHttpMiddleware = HttpRouter.middleware<{
      provides: PublicRpcRateLimitMiddleware;
    }>()(
      Effect.map(
        PublicRpcRateLimitMiddleware,
        (middleware) => (effect) =>
          Effect.provideService(
            effect,
            PublicRpcRateLimitMiddleware,
            middleware
          )
      )
    ).layer.pipe(
      Layer.provide(PublicRpcRateLimitMiddlewareLive),
      Layer.provide(RateLimitService.layerMemory)
    );
    const TestApp = Route.pipe(
      Layer.provide(RpcRateLimitHttpMiddleware),
      Layer.provide(makeClientIpGlobalMiddleware(proxyTrustResult.success))
    );
    const TestRuntime = TestApp.pipe(Layer.provideMerge(HttpRouter.layer));
    const executeRequest = (clientIp: string) => {
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/rate-limit", {
          headers: { "x-forwarded-for": clientIp },
        })
      ).modify({ remoteAddress: Option.some("10.0.0.4") });
      return Effect.flatMap(HttpRouter.HttpRouter, (router) =>
        router.asHttpEffect()
      ).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request)
      );
    };

    return Effect.gen(function* () {
      const firstClient = yield* executeRequest("198.51.100.1");
      const secondClient = yield* executeRequest("198.51.100.2");
      const firstClientAgain = yield* executeRequest("198.51.100.1");

      expect(firstClient.status).toBe(200);
      expect(secondClient.status).toBe(200);
      expect(firstClientAgain.status).toBe(429);
    }).pipe(Effect.provide(TestRuntime), Effect.scoped);
  }
);

it.effect(
  "public RPC rate limit fails closed (503) when the global ClientIp middleware is not installed",
  () => {
    const proxyTrustResult = parseClientIpProxyTrust({
      trustAllHeaders: true,
      trustedProxyCidrs: [],
    });
    if (proxyTrustResult._tag === "Failure") {
      return Effect.die(proxyTrustResult.failure);
    }

    const Route = HttpRouter.add("GET", "/no-client-ip", (request) =>
      Effect.gen(function* () {
        const middleware = yield* PublicRpcRateLimitMiddleware;
        return yield* middleware(
          Effect.gen(function* () {
            // Never runs: the middleware must fail closed on the missing
            // ClientIp service before touching the handler.
            yield* publicRpc({
              name: "NoClientIpIntegrationTest",
              level: "read",
            });
            return yield* new RateLimitUnavailableError();
          }),
          {
            client: new Rpc.ServerClient(1),
            requestId: RpcMessage.RequestId("client-ip-rate-limit-test"),
            rpc: TestRpc,
            payload: undefined,
            headers: request.headers,
          }
        ).pipe(
          Effect.as(HttpServerResponse.text("ok")),
          Effect.catchTag("RateLimitUnavailableError", () =>
            Effect.succeed(
              HttpServerResponse.text("unavailable", { status: 503 })
            )
          )
        );
      }).pipe(
        Effect.catchTag("RateLimitExceededError", () =>
          Effect.succeed(HttpServerResponse.text("limited", { status: 429 }))
        ),
        Effect.catchCause(() =>
          Effect.succeed(HttpServerResponse.text("failed", { status: 500 }))
        )
      )
    );
    const RpcRateLimitHttpMiddleware = HttpRouter.middleware<{
      provides: PublicRpcRateLimitMiddleware;
    }>()(
      Effect.map(
        PublicRpcRateLimitMiddleware,
        (middleware) => (effect) =>
          Effect.provideService(
            effect,
            PublicRpcRateLimitMiddleware,
            middleware
          )
      )
    ).layer.pipe(
      Layer.provide(PublicRpcRateLimitMiddlewareLive),
      Layer.provide(RateLimitService.layerMemory)
    );
    // Deliberately NO makeClientIpGlobalMiddleware: the middleware must refuse
    // the request rather than falling back to a shared global bucket.
    const TestApp = Route.pipe(Layer.provide(RpcRateLimitHttpMiddleware));
    const TestRuntime = TestApp.pipe(Layer.provideMerge(HttpRouter.layer));
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/no-client-ip")
    );

    return Effect.gen(function* () {
      const response = yield* Effect.flatMap(HttpRouter.HttpRouter, (router) =>
        router.asHttpEffect()
      ).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request)
      );

      expect(response.status).toBe(503);
    }).pipe(Effect.provide(TestRuntime), Effect.scoped);
  }
);
