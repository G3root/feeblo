import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AllowedOriginConfig } from "./cors";
import { makeOriginCheckMiddleware } from "./origin-check";

const productionConfig: AllowedOriginConfig = {
  appRootDomain: "feeblo.com",
  appUrl: "https://app.feeblo.com",
  apiUrl: "https://api.feeblo.com",
  nodeEnv: "production",
};

const App = (config: AllowedOriginConfig) =>
  Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/rpc",
      HttpServerResponse.text("handled", { status: 200 })
    ),
    HttpRouter.add(
      "GET",
      "/rpc",
      HttpServerResponse.text("read", { status: 200 })
    ),
    HttpRouter.middleware(makeOriginCheckMiddleware(config), { global: true })
  );

const withApp = <A, E, R>(
  config: AllowedOriginConfig,
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(App(config), { disableLogger: true })
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

const post = (
  handler: (request: Request) => Promise<globalThis.Response>,
  headers: Record<string, string>
) =>
  Effect.promise(() =>
    handler(
      new Request("https://api.feeblo.com/rpc", {
        body: "{}\n",
        headers,
        method: "POST",
      })
    )
  );

it.live("rejects a POST from an untrusted origin", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const response = yield* post(app.handler, {
        origin: "https://evil.example",
      });
      expect(response.status).toBe(403);
    })
  )
);

it.live("rejects a POST with a null origin", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const response = yield* post(app.handler, { origin: "null" });
      expect(response.status).toBe(403);
    })
  )
);

it.live("allows the app origin and root-domain subdomains", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const appOrigin = yield* post(app.handler, {
        origin: "https://app.feeblo.com",
      });
      const boardOrigin = yield* post(app.handler, {
        origin: "https://customer.feeblo.com",
      });
      expect(appOrigin.status).toBe(200);
      expect(boardOrigin.status).toBe(200);
    })
  )
);

it.live("rejects cross-site fetch metadata when origin is absent", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const response = yield* post(app.handler, {
        "sec-fetch-site": "cross-site",
      });
      expect(response.status).toBe(403);
    })
  )
);

it.live("allows same-site and non-browser requests", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const sameSite = yield* post(app.handler, {
        "sec-fetch-site": "same-site",
      });
      const noHeaders = yield* post(app.handler, {});
      expect(sameSite.status).toBe(200);
      expect(noHeaders.status).toBe(200);
    })
  )
);

it.live("allows operator-trusted origins from AUTH_TRUSTED_ORIGINS", () =>
  withApp(
    {
      ...productionConfig,
      authTrustedOrigins: [
        "https://partner.example",
        "*.boards.example",
        "*.localhost:3001",
      ],
    },
    (app) =>
      Effect.gen(function* () {
        const exact = yield* post(app.handler, {
          origin: "https://partner.example",
        });
        const wildcard = yield* post(app.handler, {
          origin: "https://team.boards.example",
        });
        const localhost = yield* post(app.handler, {
          origin: "http://board.localhost:3001",
        });
        const unrelated = yield* post(app.handler, {
          origin: "https://unrelated.example",
        });
        expect(exact.status).toBe(200);
        expect(wildcard.status).toBe(200);
        expect(localhost.status).toBe(200);
        expect(unrelated.status).toBe(403);
      })
  )
);

it.live("does not gate safe methods", () =>
  withApp(productionConfig, (app) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://api.feeblo.com/rpc", {
            headers: { origin: "https://evil.example" },
          })
        )
      );
      expect(response.status).toBe(200);
    })
  )
);
