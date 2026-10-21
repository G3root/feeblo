import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { serverTimingMiddleware } from "./server-timing";

const App = Layer.mergeAll(
  HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok")),
  HttpRouter.add("GET", "/boom", Effect.fail("boom")),
  HttpRouter.middleware(serverTimingMiddleware, { global: true })
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

const getServerTiming = (response: globalThis.Response): string | null =>
  response.headers.get("server-timing");

const getResponseTime = (response: globalThis.Response): string | null =>
  response.headers.get("x-response-time");

it.live(
  "adds Server-Timing with the total duration to successful responses",
  () =>
    withApp(({ handler }) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(new Request("http://localhost/ok"))
        );
        expect(response.status).toBe(200);
        expect(getServerTiming(response)).toMatch(
          /^total;dur=\d+(\.\d+)?;desc="GET \/ok"$/
        );
        expect(getResponseTime(response)).toMatch(/^\d+(\.\d+)?ms$/);
      })
    )
);

it.live("adds Server-Timing to error responses", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/boom"))
      );
      expect(response.status).toBe(500);
      expect(getServerTiming(response)).toMatch(
        /^total;dur=\d+(\.\d+)?;desc="GET \/boom"$/
      );
      expect(getResponseTime(response)).toMatch(/^\d+(\.\d+)?ms$/);
    })
  )
);

it.live("adds Server-Timing to unmatched routes", () =>
  withApp(({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/missing"))
      );
      expect(response.status).toBe(404);
      expect(getServerTiming(response)).toMatch(
        /^total;dur=\d+(\.\d+)?;desc="GET \/missing"$/
      );
      expect(getResponseTime(response)).toMatch(/^\d+(\.\d+)?ms$/);
    })
  )
);

it.effect("adds the request span's trace descriptors", () =>
  Effect.gen(function* () {
    const handled =
      yield* Deferred.make<HttpServerResponse.HttpServerResponse>();
    // A route that cannot fail keeps the middleware's error marker out of the
    // effect's requirements, so `toHandled` can consume it.
    const traced = Layer.mergeAll(
      HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok")),
      HttpRouter.middleware(serverTimingMiddleware, { global: true })
    ).pipe(Layer.provideMerge(HttpRouter.layer));
    const context = yield* Layer.build(traced);
    const router = Context.get(context, HttpRouter.HttpRouter);

    yield* HttpEffect.toHandled(
      // A router failure is a defect in a test; `orDie` keeps the error
      // channel typed instead of widening it to `unknown`.
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Effect's own `HttpRouter.asHttpEffect` types its failure as `unknown`; the pipe turns it into a defect, which is what a test wants
      router.asHttpEffect().pipe(Effect.orDie),
      (_request, response) => Deferred.succeed(handled, response)
    ).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://localhost/ok"))
      ),
      Effect.withSpan("test.request")
    );

    const timing =
      (yield* Deferred.await(handled)).headers["server-timing"] ?? "";
    expect(timing).toContain('feeblo-trace;desc="');
    expect(timing).toContain('feeblo-span;desc="');
    expect(timing).toMatch(/feeblo-sampled;desc="[01]"/);
  })
);
