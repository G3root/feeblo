import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { OptionalAuthMiddleware, AuthMiddleware } from "../session-middleware";
import { UserBanServiceErrors } from "./errors";
import {
  UserBanCreate,
  UserBanListRequest,
  UserBanListResult,
  UserBanRemove,
  UserBanResult,
  UserBanStatus,
  UserBanStatusRequest,
} from "./schema";

/**
 * Dashboard ban management plus the portal's own status read.
 *
 * The write handlers are dashboard-only: banning is an operator action, and a
 * banned end user has no legitimate reason to enumerate the workspace's ban
 * list. `GetUserBanStatus` is the one public read — it answers for the
 * caller's own session and never returns the operator's reason.
 */
export class UserBanRpcs extends RpcGroup.make(
  Rpc.make("ListUserBans", {
    error: UserBanServiceErrors,
    payload: UserBanListRequest,
    success: UserBanListResult,
  }).middleware(AuthMiddleware),
  Rpc.make("BanUser", {
    error: UserBanServiceErrors,
    payload: UserBanCreate,
    success: UserBanResult,
  }).middleware(AuthMiddleware),
  Rpc.make("UnbanUser", {
    error: UserBanServiceErrors,
    payload: UserBanRemove,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("GetUserBanStatus", {
    error: Schema.Union([UserBanServiceErrors, RateLimitErrors]),
    payload: UserBanStatusRequest,
    success: UserBanStatus,
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}
