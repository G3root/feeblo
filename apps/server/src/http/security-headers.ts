import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { ServerConfigValue } from "../config";

/**
 * Response security headers for every route this server answers.
 *
 * The API is JSON and images, so the policy is small and the parts that could
 * break a document are left out on purpose:
 *
 * - `frame-ancestors 'none'` / `X-Frame-Options: DENY` — nothing frames an API
 *   response. The session cookie is `SameSite=None` in production (see
 *   `packages/auth/src/server.ts`), so a framed document would carry the
 *   victim's credentials and the CSRF origin check cannot see same-origin
 *   requests made from inside the frame.
 * - `X-Content-Type-Options: nosniff` — the service answers uploaded media,
 *   `image/png` OG renders, and JSON error bodies, and a browser that sniffs
 *   any of them as HTML is the classic upload/polyglot path.
 * - `Referrer-Policy: no-referrer` — the email-subscription verify and
 *   unsubscribe links carry bearer tokens in the query string, and so does
 *   nothing else the API serves. A referrer would copy that token into any
 *   document the response is reachable from.
 * - `base-uri 'self'` — the reference page at `/api/v1/docs` is a document; no
 *   route needs to move the document base.
 *
 * No `default-src`: `/api/v1/docs` renders Scalar, which fetches its own bundle
 * from a CDN and inlines styles. A fallback directive here would take the
 * published reference offline; the framing directives above are independent of
 * resource loading and need no fallback.
 */
export const apiSecurityHeaders = ({
  includeHsts,
}: {
  readonly includeHsts: boolean;
}) => ({
  "content-security-policy": "frame-ancestors 'none'; base-uri 'self'",
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  ...(includeHsts
    ? { "strict-transport-security": "max-age=63072000; includeSubDomains" }
    : undefined),
});

/**
 * Adds {@link apiSecurityHeaders} to every response, including the ones the
 * router answers itself (404, a failed handler, a schema rejection).
 *
 * HSTS is sent when the deployment says it is production or when the request
 * arrived over HTTPS. The second half matters behind a TLS-terminating proxy
 * whose internal hop is plain HTTP: the browser only honours the header over
 * HTTPS, so sending it on that hop is how the externally-secure deployment
 * still pins the host.
 */
export const makeSecurityHeadersMiddleware = (
  config: Pick<ServerConfigValue, "nodeEnv">
) =>
  HttpMiddleware.make((httpApp) =>
    HttpEffect.withPreResponseHandler(httpApp, (request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeaders(
          response,
          apiSecurityHeaders({
            includeHsts:
              config.nodeEnv === "production" ||
              request.url.startsWith("https:"),
          })
        )
      )
    )
  );
