import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

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
