import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { BoardRepository } from "../board/repository";
import { CommentRepository } from "../comments/repository";
import { CommentService } from "../comments/service";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { UserRepository } from "../user/repository";
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
 * helper the dashboard uses; and creating, changing, or deleting a post goes
 * through the dashboard's own shared write path (`post/write.ts`), which needs
 * the board and post repositories, the creator subscription, the integration
 * event recorder, the notification fan-out, and the embedding scheduler. A new
 * private dependency is therefore one line here, not an edit in every place
 * that assembles a server or a test.
 *
 * Everything the surface shares — the database, `Auth`, the rate limiter, the
 * plan decision, media storage, the email subscription repository (whose token
 * service reads `AUTH_ENCRYPTION_KEY`, a credential the server already builds
 * once), and its own `PublicApiConfig` — stays a requirement instead, so
 * whoever assembles the server supplies the real service, and a test supplies
 * the substitute it needs (`S3Test`, a smaller rate-limit budget, a
 * `PublicApiConfig.layerTest`) without restating the surface's private wiring.
 */
export const PublicApiInternals = Layer.mergeAll(
  BoardRepository.layer,
  EmailOutboxRepository.layer,
  IntegrationEventRecorderLive,
  NotificationService.layer,
  PostActivityRepository.layer,
  PostEmbeddingService.layer,
  PostRepository.layer,
  PostSubscriptionRepository.layer,
  ResolvePrincipalService.layer,
  UserRepository.layer,
  // The shared comment write path needs its own repository; the identity
  // resolver it attributes a comment through is already above, for the post
  // write path.
  CommentRepository.layer
);

/**
 * The comment writes this route serves, composed from the internals above.
 *
 * Merged into the route rather than only provided to it: `HttpApiBuilder`
 * does not thread a handler's requirements through the route layer, so a
 * handler reads the service from the fiber context — the same shape as
 * `currentPublicApiRepository`. The service is the dashboard comment RPC's own
 * write path, so an API-created comment lands in the same timeline, the same
 * transaction, and the same notification fan-out as one written by a member.
 */
const PublicApiCommentService = CommentService.layer.pipe(
  Layer.provide(PublicApiInternals)
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
    ),
    Layer.provideMerge(PublicApiCommentService)
  );

/**
 * The route as production composes it.
 *
 * Requires the shared services the server assembles — the database, `Auth`,
 * the rate limiter, `PublicApiConfig`, the plan decision, and media storage —
 * and nothing else.
 */
export const PublicApiRoute = makePublicApiRoute(ApiKeyAuthMiddlewareLive);
