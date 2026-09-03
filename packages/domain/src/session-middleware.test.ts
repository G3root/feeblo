import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { parseCookie } from "cookie-es";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  Auth,
  currentHttpApiSession,
  HttpApiAuthMiddleware,
  makeHttpApiAuthMiddlewareLive,
  type Session,
} from "./session-middleware";

const COOKIE_A = "better-auth.session_token";
const COOKIE_B = "__Secure-better-auth.session_token";

const testSession: Session = {
  user: { id: "user-1", email: "session@test.dev", name: "Session Test" },
  session: { userId: "user-1", token: "unused" },
  organizations: [],
  memberships: [],
};

/**
 * Maps each composition's cookie name to the token it accepts, so the fake
 * better-auth endpoint only authenticates when the middleware forwarded the
 * token under the cookie name that composition resolved.
 */
const sessionsByCookieName = new Map<string, string>([
  [COOKIE_A, "token-a"],
  [COOKIE_B, "token-b"],
]);

const AuthTest = Layer.succeed(Auth, {
  handler: () => new Response(),
  api: {
    getSession: async ({ headers }) => {
      const parsed = parseCookie(headers.get("cookie") ?? "");
      const [cookieName, token] = Object.entries(parsed)[0] ?? [undefined];
      if (cookieName === undefined || token === undefined) {
        return null;
      }
      return sessionsByCookieName.get(cookieName) === token
        ? testSession
        : null;
    },
  },
});

class TestApi extends HttpApi.make("TestSessionMiddlewareApi")
  .add(
    HttpApiGroup.make("SessionA")
      .add(
        HttpApiEndpoint.get("whoamiA", "/a/whoami", { success: Schema.String })
      )
      .middleware(HttpApiAuthMiddleware)
  )
  .add(
    HttpApiGroup.make("SessionB")
      .add(
        HttpApiEndpoint.get("whoamiB", "/b/whoami", { success: Schema.String })
      )
      .middleware(HttpApiAuthMiddleware)
  ) {}

const GroupALive = HttpApiBuilder.group(TestApi, "SessionA", (handlers) =>
  handlers.handle("whoamiA", () =>
    Effect.map(currentHttpApiSession, (session) => session.user.email)
  )
);

const GroupBLive = HttpApiBuilder.group(TestApi, "SessionB", (handlers) =>
  handlers.handle("whoamiB", () =>
    Effect.map(currentHttpApiSession, (session) => session.user.email)
  )
);

const TestApp = HttpApiBuilder.layer(TestApi).pipe(
  // Each group is composed with its own middleware instance resolving a
  // different cookie name — exactly the shared-mutation hazard this guards.
  Layer.provide(
    GroupALive.pipe(
      Layer.provide(makeHttpApiAuthMiddlewareLive(() => COOKIE_A))
    )
  ),
  Layer.provide(
    GroupBLive.pipe(
      Layer.provide(makeHttpApiAuthMiddlewareLive(() => COOKIE_B))
    )
  ),
  Layer.provide(AuthTest),
  Layer.provide(Etag.layer),
  Layer.provide(NodeHttpPlatform.layer),
  Layer.provide(NodeServices.layer),
  Layer.provideMerge(HttpRouter.layer)
);

const executeRequest = (path: string, cookie: string) => {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, { headers: { cookie } })
  );
  return Effect.flatMap(HttpRouter.HttpRouter, (router) =>
    router.asHttpEffect()
  ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));
};

const responseText = (response: HttpServerResponse.HttpServerResponse) => {
  const body = response.body;
  return body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
};

it.effect(
  "each composed route authenticates against its own session cookie name",
  () =>
    Effect.gen(function* () {
      const ownCookieA = yield* executeRequest(
        "/a/whoami",
        `${COOKIE_A}=token-a`
      );
      expect(ownCookieA.status).toBe(200);
      // String success schema encodes to a JSON string literal.
      expect(responseText(ownCookieA)).toBe('"session@test.dev"');

      const ownCookieB = yield* executeRequest(
        "/b/whoami",
        `${COOKIE_B}=token-b`
      );
      expect(ownCookieB.status).toBe(200);
      expect(responseText(ownCookieB)).toBe('"session@test.dev"');

      // Composition A must not honor composition B's cookie, and vice versa.
      const foreignToken = yield* executeRequest(
        "/a/whoami",
        `${COOKIE_A}=token-b`
      );
      expect(foreignToken.status).toBe(401);

      const foreignCookie = yield* executeRequest(
        "/a/whoami",
        `${COOKIE_B}=token-a`
      );
      expect(foreignCookie.status).toBe(401);
    }).pipe(Effect.provide(TestApp), Effect.scoped)
);
