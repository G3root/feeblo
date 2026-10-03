import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";

import { boardHandlers } from "../board/public-api/http";
import { changelogHandlers } from "../changelog/public-api/http";
import { commentHandlers } from "../comments/public-api/http";
import { companyHandlers } from "../company/public-api/http";
import { statusHandlers } from "../post-status/public-api/http";
import { postHandlers } from "../post/public-api/http";
import { tagHandlers } from "../tag/public-api/http";
import { PublicApi } from "./api-contract";

/**
 * The HTTP implementations of every Public API endpoint.
 *
 * One group per resource, because a group is what carries the resource's tag
 * and its middleware; `HttpApiBuilder.group` is per-group, so this is the one
 * place that names all seven. A handler added to `post` is an edit to
 * `post/http.ts` and nothing else, so two changes to different resources do
 * not collide; a whole resource is one entry per list below.
 *
 * Each handler parses its HTTP input and delegates to an operation in that
 * resource's `operations.ts`, which is the same code an MCP tool or a CLI
 * would call.
 */
export const PublicApiLive = Layer.mergeAll(
  HttpApiBuilder.group(PublicApi, "Boards", (handlers) =>
    handlers.handleAll(boardHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Changelog", (handlers) =>
    handlers.handleAll(changelogHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Comments", (handlers) =>
    handlers.handleAll(commentHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Companies", (handlers) =>
    handlers.handleAll(companyHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Posts", (handlers) =>
    handlers.handleAll(postHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Statuses", (handlers) =>
    handlers.handleAll(statusHandlers)
  ),
  HttpApiBuilder.group(PublicApi, "Tags", (handlers) =>
    handlers.handleAll(tagHandlers)
  )
);
