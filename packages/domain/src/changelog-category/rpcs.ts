import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { ChangelogCategoryServiceErrors } from "./errors";
import {
  ChangelogCategory,
  ChangelogCategoryCreate,
  ChangelogCategoryDelete,
  ChangelogCategoryLink,
  ChangelogCategoryList,
  ChangelogCategorySet,
  ChangelogCategoryUpdate,
} from "./schema";

export class ChangelogCategoryRpcs extends RpcGroup.make(
  Rpc.make("ChangelogCategoryList", {
    payload: ChangelogCategoryList,
    success: Schema.Array(ChangelogCategory),
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogCategoryListPublic", {
    payload: ChangelogCategoryList,
    success: Schema.Array(ChangelogCategory),
    error: Schema.Union([ChangelogCategoryServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("ChangelogCategoryCreate", {
    success: Schema.Void,
    payload: ChangelogCategoryCreate,
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogCategoryUpdate", {
    success: Schema.Void,
    payload: ChangelogCategoryUpdate,
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogCategoryDelete", {
    success: Schema.Void,
    payload: ChangelogCategoryDelete,
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogCategoryListLinks", {
    payload: ChangelogCategoryList,
    success: Schema.Array(ChangelogCategoryLink),
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ChangelogCategoryListLinksPublic", {
    payload: ChangelogCategoryList,
    success: Schema.Array(ChangelogCategoryLink),
    error: Schema.Union([ChangelogCategoryServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("ChangelogCategorySet", {
    success: Schema.Void,
    payload: ChangelogCategorySet,
    error: ChangelogCategoryServiceErrors,
  }).middleware(AuthMiddleware)
) {}
