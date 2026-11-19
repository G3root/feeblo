import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { HelpCenterArticleServiceErrors } from "./errors";
import {
  HelpCenterAnalytics,
  HelpCenterAnalyticsPayload,
  HelpCenterArticle,
  HelpCenterArticleCreate,
  HelpCenterArticleDelete,
  HelpCenterArticleGet,
  HelpCenterArticleGetPublic,
  HelpCenterArticleList,
  HelpCenterArticleListPublic,
  HelpCenterArticlePublic,
  HelpCenterArticlePublicSummary,
  HelpCenterArticleSearch,
  HelpCenterArticleSearchHit,
  HelpCenterArticleSearchPublic,
  HelpCenterArticleSearchResult,
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
    .middleware(PublicRpcRateLimitMiddleware),

  /**
   * The dashboard's search: every state, including the draft being written.
   *
   * Behind the session middleware rather than the public limiter because an
   * editor is already authenticated, and behind no extra permission because
   * every member may read the documentation.
   */
  Rpc.make("SearchHelpCenterArticles", {
    payload: HelpCenterArticleSearch,
    success: Schema.Array(HelpCenterArticleSearchHit),
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware),

  /**
   * The portal's search.
   *
   * It returns the same projection the public list does, and it is the one
   * public read that also **writes**: the query is counted, with whether it
   * found anything, because "what do readers look for and not find" is the
   * only signal that says which article to write next. The write never fails
   * the read.
   */
  Rpc.make("SearchHelpCenterArticlesPublic", {
    payload: HelpCenterArticleSearchPublic,
    success: Schema.Array(HelpCenterArticleSearchResult),
    error: Schema.Union([HelpCenterArticleServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  /**
   * The dashboard's analytics for one window.
   *
   * One operation for the whole panel, for the same reason the insights page is
   * one: the page renders every number together, and a per-metric operation
   * would make the panel's cost the sum of its round trips.
   */
  Rpc.make("GetHelpCenterAnalytics", {
    payload: HelpCenterAnalyticsPayload,
    success: HelpCenterAnalytics,
    error: HelpCenterArticleServiceErrors,
  }).middleware(AuthMiddleware)
) {}
