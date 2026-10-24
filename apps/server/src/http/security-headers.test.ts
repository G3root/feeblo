import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import {
  apiSecurityHeaders,
  makeSecurityHeadersMiddleware,
} from "./security-headers";

const appFor = (nodeEnv: string) =>
  Layer.mergeAll(
    HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok")),
    HttpRouter.middleware(makeSecurityHeadersMiddleware({ nodeEnv }), {
      global: true,
    })
  );

const withApp = <A, E, R>(
  nodeEnv: string,
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(appFor(nodeEnv), { disableLogger: true })
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

it.live("adds the framing and content-type headers to a routed response", () =>
  withApp("development", ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/ok"))
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'none'; base-uri 'self'"
      );
    })
  )
);

it.live("covers responses the router answers itself", () =>
  withApp("development", ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/missing"))
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    })
  )
);

it.live("omits HSTS outside production on a plain-HTTP request", () =>
  withApp("development", ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/ok"))
      );

      expect(response.headers.get("strict-transport-security")).toBeNull();
    })
  )
);

it.live(
  "sends HSTS for a production deployment behind a plain-HTTP proxy",
  () =>
    withApp("production", ({ handler }) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(new Request("http://localhost/ok"))
        );

        expect(response.headers.get("strict-transport-security")).toBe(
          "max-age=63072000; includeSubDomains"
        );
      })
    )
);

it.live("sends HSTS when the request itself arrived over HTTPS", () =>
  withApp("development", ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("https://localhost/ok"))
      );

      expect(response.headers.get("strict-transport-security")).toBeDefined();
    })
  )
);

it("keeps the API policy free of a resource fallback the docs page needs", () => {
  const policy = apiSecurityHeaders({ includeHsts: false })[
    "content-security-policy"
  ];

  expect(policy).not.toContain("default-src");
  expect(policy).not.toContain("script-src");
  expect(policy).toContain("frame-ancestors 'none'");
});
