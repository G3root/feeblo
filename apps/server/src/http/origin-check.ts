import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AllowedOriginConfig } from "./cors";
import { makeIsAllowedOrigin } from "./cors";

/**
 * Methods that must not be executable from a cross-site page when the request
 * carries session cookies. GET/HEAD/OPTIONS are left alone: the credentialed
 * routes that mutate state are all POST/PUT/PATCH/DELETE.
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `Sec-Fetch-Site` values that identify a request initiated by the user or by
 * an origin Feeblo already trusts. `cross-site` (and any unknown value) is
 * rejected when no `Origin` header is present.
 */
const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

/**
 * Matches the better-auth session cookie, with or without the `__Secure-`
 * prefix. Used only to decide whether a headerless state-changing request is
 * credential-bearing; the cookie value never leaves this middleware.
 */
const SESSION_COOKIE_PATTERN =
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

/**
 * Effect HTTP surfaces whose handlers authenticate from cookies. better-auth's
 * own routes (`/api/auth/*`) enforce their origin policy themselves, and
 * `/__e2e/*` only exists outside production, so neither is subject to the
 * headerless-credential rule below.
 */
const isCookieAuthenticatedEffectPath = (path: string): boolean =>
  (path === "/rpc" || path.startsWith("/rpc/") || path.startsWith("/api/")) &&
  path !== "/api/auth" &&
  !path.startsWith("/api/auth/");

const requestPath = (request: HttpServerRequest.HttpServerRequest): string =>
  request.url.split("?")[0] ?? "";

const forbidden = () =>
  HttpServerResponse.text("Cross-site request rejected", { status: 403 });

/**
 * Rejects cross-site state-changing requests.
 *
 * The production session cookie is `SameSite=None` (required so boards on
 * `*.feeblo.com` and customer domains can share the session), so browsers send
 * it on cross-site POSTs. Effect's CORS middleware only decorates responses —
 * it never blocks a request — so without this check any third-party page can
 * drive `/rpc` and the credentialed `/api/*` endpoints with the victim's
 * session (CSRF).
 *
 * Browsers attach `Origin` to every state-changing request, including
 * `fetch(..., { mode: "no-cors" })` and HTML form submissions. A present but
 * untrusted origin, or an explicit cross-site fetch metadata signal, is
 * therefore rejected. Requests without either header normally come from
 * non-browser clients (server-to-server, webhooks, tests) and are allowed, but
 * a cookie-bearing request to a cookie-authenticated Effect route must still
 * prove its origin: browsers always send at least one of the two headers, so
 * the headerless credential case fails closed instead of silently skipping the
 * CSRF boundary.
 */
export const makeOriginCheckMiddleware = (config: AllowedOriginConfig) => {
  const isAllowedOrigin = makeIsAllowedOrigin(config);

  return HttpMiddleware.make((httpApp) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
      if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
        return httpApp;
      }

      const origin = Option.getOrUndefined(
        Headers.get(request.headers, "origin")
      );
      if (origin !== undefined) {
        // A literal "null" origin (sandboxed frame, file://, opaque origin) is
        // never a trusted Feeblo origin.
        return isAllowedOrigin(origin) ? httpApp : Effect.succeed(forbidden());
      }

      const fetchSite = Option.getOrUndefined(
        Headers.get(request.headers, "sec-fetch-site")
      );
      if (fetchSite !== undefined) {
        return SAFE_FETCH_SITES.has(fetchSite)
          ? httpApp
          : Effect.succeed(forbidden());
      }

      const cookie = Option.getOrUndefined(
        Headers.get(request.headers, "cookie")
      );
      const carriesSession =
        cookie !== undefined && SESSION_COOKIE_PATTERN.test(cookie);
      if (
        carriesSession &&
        isCookieAuthenticatedEffectPath(requestPath(request))
      ) {
        return Effect.succeed(forbidden());
      }

      return httpApp;
    })
  );
};
