import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";

import {
  httpMetricsMiddleware,
  httpServerRequestDuration,
  httpServerRequests,
} from "./http-metrics";

const App = Layer.mergeAll(
  HttpRouter.add("GET", "/metrics-ok", HttpServerResponse.text("ok")),
  HttpRouter.add("GET", "/metrics-posts/:postId", HttpServerResponse.text("p")),
  HttpRouter.add("GET", "/metrics-boom", Effect.fail("boom")),
  HttpRouter.add(
    "GET",
    "/metrics-not-found",
    HttpServerResponse.empty({ status: 404 })
  ),
  HttpRouter.add("GET", "/metrics-slow", HttpServerResponse.text("slow")),
  HttpRouter.middleware(httpMetricsMiddleware, { global: true })
);

const withApp = <A, E, R>(
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(App, { disableLogger: true })),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

it.live("records method, route, and status for a successful request", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-ok"))
      );
      expect(response.status).toBe(200);

      const value = yield* Metric.value(
        Metric.withAttributes(httpServerRequests, {
          method: "GET",
          route: "/metrics-ok",
          status: "200",
        })
      );
      expect(value.count).toBe(1);
    })
  )
);

it.live("labels matched requests with the router's route template", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-posts/lg_abc123def456"))
      );
      expect(response.status).toBe(200);

      const value = yield* Metric.value(
        Metric.withAttributes(httpServerRequests, {
          method: "GET",
          route: "/metrics-posts/:postId",
          status: "200",
        })
      );
      expect(value.count).toBe(1);
    })
  )
);

it.live("records failed and unmatched requests with their status", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const failed = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-boom"))
      );
      const notFound = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-not-found"))
      );
      const missing = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-missing"))
      );
      expect(failed.status).toBe(500);
      expect(notFound.status).toBe(404);
      expect(missing.status).toBe(404);

      const failedValue = yield* Metric.value(
        Metric.withAttributes(httpServerRequests, {
          method: "GET",
          route: "/metrics-boom",
          status: "500",
        })
      );
      // A matched handler that answers 404 keeps its route template...
      const notFoundValue = yield* Metric.value(
        Metric.withAttributes(httpServerRequests, {
          method: "GET",
          route: "/metrics-not-found",
          status: "404",
        })
      );
      // ...and only genuinely unmatched paths collapse to one label, so
      // scanner traffic cannot mint a route label per path.
      const missingValue = yield* Metric.value(
        Metric.withAttributes(httpServerRequests, {
          method: "GET",
          route: "unmatched",
          status: "404",
        })
      );
      expect(failedValue.count).toBe(1);
      expect(notFoundValue.count).toBe(1);
      expect(missingValue.count).toBe(1);
    })
  )
);

it.live("records the request duration histogram", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/metrics-slow"))
      );
      expect(response.status).toBe(200);

      const value = yield* Metric.value(
        Metric.withAttributes(httpServerRequestDuration, {
          method: "GET",
          route: "/metrics-slow",
        })
      );
      expect(value.count).toBe(1);
    })
  )
);
