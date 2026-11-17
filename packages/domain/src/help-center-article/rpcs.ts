import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { HelpCenterArticleServiceErrors } from "./errors";
import {
  HelpCenterArticle,
  HelpCenterArticleCreate,
  HelpCenterArticleDelete,
  HelpCenterArticleGet,
  HelpCenterArticleGetPublic,
  HelpCenterArticleList,
  HelpCenterArticleListPublic,
  HelpCenterArticlePublic,
  HelpCenterArticlePublicSummary,
  HelpCenterArticleSummary,
  HelpCenterArticleUpdate,
  HelpCenterArticleViewAccepted,
  HelpCenterArticleViewRecord,
} from "./schema";

/**
 * Help center articles, on both RPC surfaces.
 *
 * Two differences between them, both deliberate:
 *
 * - The dashboard reads by `id` and sees drafts; the portal reads by `slug` and
 *   sees only the states the lifecycle calls readable. A portal reader never
 *   learns a draft exists.
 * - The view beacon is the one public **write**. It answers the same thing
 *   whether it stored, deduplicated or discarded a read, so it cannot be used
 *   to probe for drafts — the same contract the post traffic ingest states, and
 *   the reason its success type carries no article data.
 */
export class HelpCenterArticleRpcs extends RpcGroup.make(
  Rpc.make("ListHelpCenterArticles", {
    payload: HelpCenterArticleList,
    success: Schema.Array(HelpCenterArticleSummary),
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListHelpCenterArticlesPublic", {
    payload: HelpCenterArticleListPublic,
    success: Schema.Array(HelpCenterArticlePublicSummary),
    error: Schema.Union([HelpCenterArticleServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("GetHelpCenterArticle", {
    payload: HelpCenterArticleGet,
    success: HelpCenterArticle,
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("GetHelpCenterArticlePublic", {
    payload: HelpCenterArticleGetPublic,
    success: HelpCenterArticlePublic,
    error: Schema.Union([HelpCenterArticleServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("CreateHelpCenterArticle", {
    payload: HelpCenterArticleCreate,
    success: Schema.Void,
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdateHelpCenterArticle", {
    payload: HelpCenterArticleUpdate,
    success: Schema.Void,
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("DeleteHelpCenterArticle", {
    payload: HelpCenterArticleDelete,
    success: Schema.Void,
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("AddHelpCenterArticleView", {
    payload: HelpCenterArticleViewRecord,
    success: HelpCenterArticleViewAccepted,
    error: Schema.Union([HelpCenterArticleServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}
