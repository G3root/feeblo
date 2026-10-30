import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { makeHttpCorsMiddleware, shouldMountE2eRoutes } from "./router";

/**
 * The rule that keeps the test-only routes off the network.
 *
 * A lone `E2E_TEST_MAILER=true` used to be enough to serve `/__e2e/emails`
 * (every rendered email, including password-reset links and verification
 * codes), `/__e2e/set-plan`, and `/__e2e/seed-roadmap` in any non-production
 * environment. Each condition below is one half of the fix.
 */
describe("shouldMountE2eRoutes", () => {
  const enabled = {
    e2eRoutesEnabled: true,
    hasMailbox: true,
    nodeEnv: "development",
  };

  it("mounts with the explicit route flag, a mailbox, and a non-production environment", () => {
    expect(shouldMountE2eRoutes(enabled)).toBe(true);
  });

  it("does not mount from the mailer flag alone", () => {
    expect(shouldMountE2eRoutes({ ...enabled, e2eRoutesEnabled: false })).toBe(
      false
    );
  });

  it("does not mount without a mailbox to serve", () => {
    expect(shouldMountE2eRoutes({ ...enabled, hasMailbox: false })).toBe(false);
  });

  it("never mounts in production", () => {
    expect(shouldMountE2eRoutes({ ...enabled, nodeEnv: "production" })).toBe(
      false
    );
  });
});

/**
 * The CORS exception for discovery documents.
 *
 * Effect's CORS middleware answers every `OPTIONS` before routing and gives a
 * disallowed origin only `Vary: Origin`, so a browser-based registry could not
 * preflight a conditional GET of the server card. The exception is scoped to
 * the discovery paths; every other route keeps the configured origin policy.
 */
const corsConfig = {
  appUrl: "https://app.feeblo.com",
  apiUrl: "https://api.feeblo.com",
  appRootDomain: "feeblo.com",
  nodeEnv: "production",
} as const;

const withCorsApp = <A, E, R>(
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        HttpRouter.use((router) =>
          Effect.gen(function* () {
            yield* router.add("GET", "/health", () =>
              Effect.succeed(HttpServerResponse.empty({ status: 200 }))
            );
            yield* router.add("GET", "/.well-known/mcp/server-card.json", () =>
              Effect.succeed(HttpServerResponse.empty({ status: 200 }))
            );
          })
        ).pipe(
          Layer.provide(
            HttpRouter.middleware(makeHttpCorsMiddleware(corsConfig), {
              global: true,
            })
          )
        ),
        { disableLogger: true }
      )
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

const preflight = (path: string) =>
  new Request(`https://api.feeblo.com${path}`, {
    method: "OPTIONS",
    headers: {
      origin: "https://registry.example",
      "access-control-request-method": "GET",
      "access-control-request-headers": "if-none-match",
    },
  });

it.live("answers a discovery preflight for an untrusted origin", () =>
  withCorsApp((app) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        app.handler(preflight("/.well-known/mcp/server-card.json"))
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-headers")).toContain(
        "If-None-Match"
      );
    })
  )
);

it.live("keeps the configured origin policy on other preflights", () =>
  withCorsApp((app) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        app.handler(preflight("/health"))
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toContain("Origin");
    })
  )
);
