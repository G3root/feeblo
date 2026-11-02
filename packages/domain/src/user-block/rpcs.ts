import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { OptionalAuthMiddleware, AuthMiddleware } from "../session-middleware";
import { UserBlockServiceErrors } from "./errors";
import {
  UserBlockCreate,
  UserBlockListRequest,
  UserBlockListResult,
  UserBlockRemove,
  UserBlockStatus,
  UserBlockStatusRequest,
  UserBlockSummary,
} from "./schema";

/**
 * Dashboard block management plus the portal's own status read.
 *
 * The write handlers are dashboard-only: blocking is an operator action, and a
 * blocked end user has no legitimate reason to enumerate the workspace's block
 * list. `GetUserBlockStatus` is the one public read — it answers for the
 * caller's own session and never returns the operator's reason.
 */
export class UserBlockRpcs extends RpcGroup.make(
  Rpc.make("ListUserBlocks", {
    error: UserBlockServiceErrors,
    payload: UserBlockListRequest,
    success: UserBlockListResult,
  }).middleware(AuthMiddleware),
  Rpc.make("BlockUser", {
    error: UserBlockServiceErrors,
    payload: UserBlockCreate,
    success: UserBlockSummary,
  }).middleware(AuthMiddleware),
  Rpc.make("UnblockUser", {
    error: UserBlockServiceErrors,
    payload: UserBlockRemove,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("GetUserBlockStatus", {
    error: Schema.Union([UserBlockServiceErrors, RateLimitErrors]),
    payload: UserBlockStatusRequest,
    success: UserBlockStatus,
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}
