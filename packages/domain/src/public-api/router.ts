import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { EmailOutboxRepository } from "../email-outbox/repository";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PublicApi } from "./api-contract";
import { PublicApiLive } from "./api-live";
import {
  ApiKeyAuthMiddleware,
  ApiKeyAuthMiddlewareLive,
  PublicApiSchemaErrorHandlerLive,
} from "./middleware";
import { PublicApiRepository } from "./repository";

/**
 * The `/api/v1` route tree.
 *
 * Its own `HttpApi` instance and its own OpenAPI document, served publicly: a
 * paid API that customers cannot self-serve is not shippable, and the
 * dashboard's internal spec stays dev-only. The plan gate lives in the key
 * middleware, so every endpoint below is paid-only by construction rather than
 * by remembering to check.
 *
 * The surface owns the layers that only it reads and requires everything it
 * shares with the rest of the server; `PublicApiInternals` below is where that
 * line falls and why.
 */

/**
 * The layers the Public API reads and no other surface does.
 *
 * They are what its write path needs to do what the dashboard's write path
 * does: the repository records tag changes in a post's timeline, so it needs
 * the activity repository at construction time; publishing a changelog entry
 * records a durable email intent and notifies subscribers through the same
 * helper the dashboard uses. A new private dependency is therefore one line
 * here, not an edit in every place that assembles a server or a test.
 *
 * Everything the surface shares — the database, `Auth`, the rate limiter, the
 * plan decision, media storage, and its own `PublicApiConfig` — stays a
 * requirement instead, so whoever assembles the server supplies the real
 * service, and a test supplies the substitute it needs (`S3Test`, a smaller
 * rate-limit budget, a `PublicApiConfig.layerTest`) without restating the
 * surface's private wiring.
 */
const PublicApiInternals = Layer.mergeAll(
  EmailOutboxRepository.layer,
  NotificationService.layer,
  PostActivityRepository.layer
);

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
  }).pipe(
    Layer.provide(PublicApiLive),
    Layer.provide(middleware),
    // Declares no requirements of its own: answering a request the schema
    // rejected is part of this API's contract, not something the composition
    // root supplies.
    Layer.provide(PublicApiSchemaErrorHandlerLive),
    // Merged rather than only provided: the repository stays in this layer's
    // output because a test drives it directly to reach the races the HTTP
    // surface cannot produce (a row that vanishes between a read and a write).
    Layer.provideMerge(
      PublicApiRepository.layer.pipe(Layer.provide(PublicApiInternals))
    )
  );

/**
 * The route as production composes it.
 *
 * Requires the shared services the server assembles — the database, `Auth`,
 * the rate limiter, `PublicApiConfig`, the plan decision, and media storage —
 * and nothing else.
 */
export const PublicApiRoute = makePublicApiRoute(ApiKeyAuthMiddlewareLive);
