import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { PostStatusServiceErrors } from "./errors";
import {
  PostStatus,
  PostStatusCreate,
  PostStatusDelete,
  PostStatusDeletePreview,
  PostStatusDeletePreviewResult,
  PostStatusDeleteResult,
  PostStatusList,
  PostStatusMakeDefault,
  PostStatusReorder,
  PostStatusUpdate,
} from "./schema";

export class PostStatusRpcs extends RpcGroup.make(
  Rpc.make("ListPostStatuses", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListPostStatusesPublic", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: Schema.Union([PostStatusServiceErrors, RateLimitErrors]),
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreatePostStatus", {
    success: Schema.Void,
    payload: PostStatusCreate,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdatePostStatus", {
    success: Schema.Void,
    payload: PostStatusUpdate,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SetPostStatusDefault", {
    success: Schema.Void,
    payload: PostStatusMakeDefault,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeletePostStatus", {
    success: PostStatusDeleteResult,
    payload: PostStatusDelete,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PreviewPostStatusDelete", {
    success: PostStatusDeletePreviewResult,
    payload: PostStatusDeletePreview,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ReorderPostStatuses", {
    success: Schema.Void,
    payload: PostStatusReorder,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware)
) {}
