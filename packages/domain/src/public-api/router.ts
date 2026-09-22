import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { PublicApi } from "./api-contract";
import { PublicApiLive } from "./api-live";
import { ApiKeyAuthMiddleware, ApiKeyAuthMiddlewareLive } from "./middleware";

/**
 * The `/api/v1` route tree.
 *
 * Its own `HttpApi` instance and its own OpenAPI document, served publicly: a
 * paid API that customers cannot self-serve is not shippable, and the
 * dashboard's internal spec stays dev-only. The plan gate lives in the key
 * middleware, so every endpoint below is paid-only by construction rather than
 * by remembering to check.
 *
 * Repository and config layers are supplied by the composition root, exactly
 * as they are for the internal `HttpRoute`, so this layer's requirements are
 * visible where the server is assembled.
 */
/**
 * Builds the route with a specific key middleware.
 *
 * The middleware is a parameter so a test can compose the same route with a
 * smaller rate-limit budget instead of re-declaring the route shape — which
 * would let the test drift from what ships.
 */
export const makePublicApiRoute = <E, R>(
  middleware: Layer.Layer<ApiKeyAuthMiddleware, E, R>
) =>
  HttpApiBuilder.layer(PublicApi, {
    openapiPath: "/api/v1/openapi.json",
  }).pipe(Layer.provide(PublicApiLive), Layer.provide(middleware));

/** The route as production composes it. */
export const PublicApiRoute = makePublicApiRoute(ApiKeyAuthMiddlewareLive);
