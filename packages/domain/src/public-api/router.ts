import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../board/repository";
import { ChangelogRepository } from "../changelog/repository";
import { CommentRepository } from "../comments/repository";
import { CompanyRepository } from "../company/repository";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { ResolvePrincipalService } from "../identity/service";
import { NotificationService } from "../notification/service";
import { PostActivityRepository } from "../post-activity/repository";
import { PostStatusRepository } from "../post-status/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { PostEmbeddingService } from "../post/embedding-service";
import { PostRepository } from "../post/repository";
import { TagRepository } from "../tag/repository";
import { UpvoteRepository } from "../upvote/repository";
import { UserRepository } from "../user/repository";
import { PublicApi } from "./api-contract";
import { PublicApiLive } from "./api-live";
import {
  ApiKeyAuthMiddleware,
  ApiKeyAuthMiddlewareLive,
  PublicApiSchemaErrorHandlerLive,
} from "./middleware";
import { PublicApiProjections } from "./projections";

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
 * The layers the surface's own repositories need at construction time.
 *
 * They are closed over so the route does not require them, and they are what
 * its write paths need to do what the dashboard's write paths do: a tag
 * assignment records a change in a post's timeline, so it needs the activity
 * repository at construction time; publishing a changelog entry records a
 * durable email intent and notifies subscribers through the same helper the
 * dashboard uses; and creating, changing, or deleting a post goes through the
 * dashboard's own shared write path (`post/write.ts`), which needs the board
 * and post repositories, the creator subscription, the integration event
 * recorder, the notification fan-out, and the embedding scheduler. A new
 * dependency is therefore one line here, not an edit in every place that
 * assembles a server or a test.
 *
 * Everything the surface shares with the server — the database, `Auth`, the
 * rate limiter, the plan decision, media storage, the email subscription
 * repository (whose token service reads `AUTH_ENCRYPTION_KEY`, a credential
 * the server already builds once), and its own `PublicApiConfig` — stays a
 * requirement instead, so whoever assembles the server supplies the real
 * service, and a test supplies the substitute it needs (`S3Test`, a smaller
 * rate-limit budget, a `PublicApiConfig.layerTest`) without restating the
 * surface's private wiring.
 */
export const PublicApiInternals = Layer.mergeAll(
  BoardRepository.layer,
  ChangelogRepository.layer,
  CompanyRepository.layer,
  EmailOutboxRepository.layer,
  IntegrationEventRecorderLive,
  NotificationService.layer,
  PostActivityRepository.layer,
  PostEmbeddingService.layer,
  PostRepository.layer,
  PostStatusRepository.layer,
  PostSubscriptionRepository.layer,
  ResolvePrincipalService.layer,
  TagRepository.layer,
  UserRepository.layer,
  // The shared on-behalf vote write path (`upvote/on-behalf.ts`) resolves a
  // voter, records the timeline entry, and subscribes them through the same
  // repositories the dashboard's voter management uses.
  UpvoteRepository.layer,
  // The shared comment write path needs its own repository; the identity
  // resolver it attributes a comment through is already above, for the post
  // write path.
  CommentRepository.layer
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
    // Merged rather than only provided: the projections stay in this layer's
    // output because the middleware tests drive the repositories directly to
    // reach races the HTTP surface cannot produce (a row that vanishes between
    // a read and a write). The bundle is shared with `/mcp`, so a projection
    // added for one surface is composed for both.
    Layer.provideMerge(
      PublicApiProjections.pipe(Layer.provide(PublicApiInternals))
    ),
    // Provided into the request context, not merged into the output: the
    // public operations read the shared feature repositories — and the
    // database handle they run transactions on — from the fiber context, the
    // same way they read the caller and the config. This is the one line that
    // makes `<feature>/public-api` able to call `<feature>/repository`
    // directly instead of owning a second copy of it.
    Layer.provide(PublicApiInternals)
  );

/**
 * The route as production composes it.
 *
 * Requires the shared services the server assembles — the database, `Auth`,
 * the rate limiter, `PublicApiConfig`, the plan decision, and media storage —
 * and nothing else.
 */
export const PublicApiRoute = makePublicApiRoute(ApiKeyAuthMiddlewareLive);
