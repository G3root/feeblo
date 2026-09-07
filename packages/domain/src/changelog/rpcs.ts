import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { ChangelogServiceErrors } from "./errors";
import {
  Changelog,
  ChangelogCreate,
  ChangelogDelete,
  ChangelogGet,
  ChangelogList,
  ChangelogSendUpdate,
  ChangelogUpdate,
} from "./schema";

export class ChangelogRpcs extends RpcGroup.make(
  Rpc.make("ChangelogList", {
    payload: ChangelogList,
    success: Schema.Array(Changelog),
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogListPublic", {
    payload: ChangelogList,
    success: Schema.Array(Changelog),
    error: Schema.Union([ChangelogServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  // Single-entry fetch for detail pages (SEO metadata). Lists return up to
  // `PUBLIC_CHANGELOG_LIMIT` full bodies; resolving one entry through the
  // list wastes that entire payload per request.
  Rpc.make("ChangelogGetPublic", {
    payload: ChangelogGet,
    success: Changelog,
    error: Schema.Union([ChangelogServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("ChangelogCreate", {
    success: Schema.Void,
    payload: ChangelogCreate,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogDelete", {
    success: Schema.Void,
    payload: ChangelogDelete,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogUpdate", {
    success: Schema.Void,
    payload: ChangelogUpdate,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogSendUpdate", {
    success: Schema.Void,
    payload: ChangelogSendUpdate,
    error: ChangelogServiceErrors,
  }).middleware(AuthMiddleware)
) {}
