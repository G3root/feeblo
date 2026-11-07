import { expect, it } from "@effect/vitest";
import {
  ClientIpProxyTrustNone,
  makeClientIpGlobalMiddleware,
} from "@feeblo/domain/client-ip";
import { Auth, type AuthHandler } from "@feeblo/domain/session-middleware";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";

import { BetterAuthRouterLive } from "./routers";

/**
 * The provider's discovery documents are served by the auth handler, which is
 * mounted at `/api/auth/*`, while RFC 8414 and RFC 9728 put them at the API
 * origin root. This pins the forwarding: if these paths stop reaching the
 * handler, an MCP client discovers nothing and the OAuth flow never starts
 * (docs/adr/0024).
 *
 * The handler is a stub, so the test asserts routing — which path arrived —
 * rather than the provider's document, which the provider's own tests cover.
 */
const pathsSeen: string[] = [];

const FakeAuth: Layer.Layer<Auth> = Layer.succeed(Auth, {
  handler: (request) => {
    pathsSeen.push(new URL(request.url).pathname);
    return new Response("reached");
  },
  api: {
    getSession: async () => null,
    createApiKey: () =>
      Promise.reject(new Error("Not available in this composition")),
    verifyApiKey: () =>
      Promise.reject(new Error("Not available in this composition")),
    verifyMcpAccessToken: async () => ({
      _tag: "Rejected" as const,
      status: 401,
      message: "Not available in this composition.",
      headers: {},
    }),
  },
} satisfies AuthHandler);

const withApp = <A, E, R>(
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        BetterAuthRouterLive.pipe(
          Layer.provide(FakeAuth),
          // The forwarder reads the peer-validated client IP the production
          // tree provides globally; without it the route defects.
          Layer.provide(makeClientIpGlobalMiddleware(ClientIpProxyTrustNone))
        ),
        { disableLogger: true }
      )
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

const request = (
  app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
  },
  path: string
) =>
  Effect.promise(() =>
    app.handler(new Request(`https://api.feeblo.com${path}`))
  );

const DISCOVERY_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server/api/auth",
] as const;

it.live("forwards the provider's discovery paths at the origin root", () =>
  withApp((app) =>
    Effect.gen(function* () {
      for (const path of DISCOVERY_PATHS) {
        pathsSeen.length = 0;
        const response = yield* request(app, path);
        expect(response.status).toBe(200);
        expect(pathsSeen).toEqual([path]);
      }
    })
  )
);

it.live("keeps the auth mount under /api/auth", () =>
  withApp((app) =>
    Effect.gen(function* () {
      pathsSeen.length = 0;
      const response = yield* request(app, "/api/auth/get-session");
      expect(response.status).toBe(200);
      expect(pathsSeen).toEqual(["/api/auth/get-session"]);
    })
  )
);
