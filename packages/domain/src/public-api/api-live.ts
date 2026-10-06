import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";

import { boardHandlers } from "../board/public-api/http";
import { changelogHandlers } from "../changelog/public-api/http";
import { commentHandlers } from "../comments/public-api/http";
import { companyHandlers } from "../company/public-api/http";
import { endUserHandlers } from "../contact/public-api/http";
import { statusHandlers } from "../post-status/public-api/http";
import { postHandlers } from "../post/public-api/http";
import { tagHandlers } from "../tag/public-api/http";
import { voteHandlers } from "../upvote/public-api/http";
import { PublicApi } from "./api-contract";
import type { PublicApiDependencies } from "./operations";

/**
 * Captures the surface's stable dependencies when a group is built.
 *
 * `HttpApiBuilder` wraps a handler's requirements in a request the route layer
 * cannot satisfy, so a handler reads its collaborators from the context its
 * group was built in. Yielding them here — a typed `Effect.context`, not a
 * `Context.getUnsafe` at request time — puts them in the group layer's own
 * requirement channel, so a missing layer fails this file's type instead of
 * one request.
 */
const captureDependencies = <A>(
  build: (context: Context.Context<PublicApiDependencies>) => A
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PublicApiDependencies>();
    return build(context);
  });

/**
 * The HTTP implementations of every Public API endpoint.
 *
 * One group per resource, because a group is what carries the resource's tag
 * and its middleware; `HttpApiBuilder.group` is per-group, so this is the one
 * place that names all nine. A handler added to `post` is an edit to
 * `post/http.ts` and nothing else, so two changes to different resources do
 * not collide; a whole resource is one entry per list below.
 *
 * Each handler parses its HTTP input and delegates to an operation in that
 * resource's `operations.ts`, which is the same code an MCP tool or a CLI
 * would call. The operation's own dependencies are provided to the handler at
 * construction, so the handler is left with the key middleware's request-scoped
 * caller and nothing else.
 */
export const PublicApiLive = Layer.mergeAll(
  HttpApiBuilder.group(PublicApi, "Boards", (handlers) =>
    captureDependencies((context) => handlers.handleAll(boardHandlers(context)))
  ),
  HttpApiBuilder.group(PublicApi, "Changelog", (handlers) =>
    captureDependencies((context) =>
      handlers.handleAll(changelogHandlers(context))
    )
  ),
  HttpApiBuilder.group(PublicApi, "Comments", (handlers) =>
    captureDependencies((context) =>
      handlers.handleAll(commentHandlers(context))
    )
  ),
  HttpApiBuilder.group(PublicApi, "Companies", (handlers) =>
    captureDependencies((context) =>
      handlers.handleAll(companyHandlers(context))
    )
  ),
  HttpApiBuilder.group(PublicApi, "End users", (handlers) =>
    captureDependencies((context) =>
      handlers.handleAll(endUserHandlers(context))
    )
  ),
  HttpApiBuilder.group(PublicApi, "Posts", (handlers) =>
    captureDependencies((context) => handlers.handleAll(postHandlers(context)))
  ),
  HttpApiBuilder.group(PublicApi, "Statuses", (handlers) =>
    captureDependencies((context) =>
      handlers.handleAll(statusHandlers(context))
    )
  ),
  HttpApiBuilder.group(PublicApi, "Tags", (handlers) =>
    captureDependencies((context) => handlers.handleAll(tagHandlers(context)))
  ),
  HttpApiBuilder.group(PublicApi, "Votes", (handlers) =>
    captureDependencies((context) => handlers.handleAll(voteHandlers(context)))
  )
);
