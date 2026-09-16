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
 * therefore rejected. Requests without either header come from non-browser
 * clients (server-to-server, webhooks, tests) and are allowed, matching the
 * CORS trust model.
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
      if (fetchSite !== undefined && !SAFE_FETCH_SITES.has(fetchSite)) {
        return Effect.succeed(forbidden());
      }

      return httpApp;
    })
  );
};
