import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import {
  apiSecurityHeaders,
  deploymentServesHttps,
  makeSecurityHeadersMiddleware,
} from "./security-headers";

const HSTS = "max-age=63072000; includeSubDomains";

const appFor = (includeHsts: boolean) =>
  Layer.mergeAll(
    HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok")),
    HttpRouter.middleware(makeSecurityHeadersMiddleware({ includeHsts }), {
      global: true,
    })
  );

const withApp = <A, E, R>(
  includeHsts: boolean,
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(appFor(includeHsts), { disableLogger: true })
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

it.live("adds the framing and content-type headers to a routed response", () =>
  withApp(false, ({ handler }) =>
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
  withApp(false, ({ handler }) =>
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

it.live("omits HSTS when the deployment does not declare HTTPS", () =>
  withApp(false, ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("https://localhost/ok"))
      );

      expect(response.headers.get("strict-transport-security")).toBeNull();
    })
  )
);

it.live("sends HSTS when the deployment declares HTTPS", () =>
  withApp(true, ({ handler }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/ok"))
      );

      // The internal hop is plain HTTP behind the proxy; the header is what the
      // operator declared for the public origin, so it is sent regardless.
      expect(response.headers.get("strict-transport-security")).toBe(HSTS);
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

it("treats production as HTTPS", () => {
  expect(
    deploymentServesHttps({
      apiUrl: "http://localhost:3000",
      nodeEnv: "production",
    })
  ).toBe(true);
});

it("treats an HTTPS public origin as HTTPS outside production", () => {
  expect(
    deploymentServesHttps({
      apiUrl: "https://api.example.com",
      nodeEnv: "development",
    })
  ).toBe(true);
});

it("does not treat a plain-HTTP public origin as HTTPS", () => {
  expect(
    deploymentServesHttps({
      apiUrl: "http://localhost:3000",
      nodeEnv: "development",
    })
  ).toBe(false);
});

it("does not trust an unparseable public origin", () => {
  expect(
    deploymentServesHttps({ apiUrl: "not a url", nodeEnv: "development" })
  ).toBe(false);
});
