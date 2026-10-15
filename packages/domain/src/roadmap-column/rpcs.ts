import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as S from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { RoadmapColumnServiceErrors } from "./errors";
import {
  RoadmapColumnCreate,
  RoadmapColumnDelete,
  RoadmapColumnList,
  RoadmapColumnUpdate,
  StatusRoadmapColumn,
} from "./schema";
export class RoadmapColumnRpcs extends RpcGroup.make(
  Rpc.make("ListRoadmapColumns", {
    success: S.Array(StatusRoadmapColumn),
    payload: RoadmapColumnList,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListRoadmapColumnsPublic", {
    success: S.Array(StatusRoadmapColumn),
    payload: RoadmapColumnList,
    error: S.Union([RoadmapColumnServiceErrors, RateLimitErrors]),
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateRoadmapColumn", {
    success: S.Void,
    payload: RoadmapColumnCreate,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateRoadmapColumn", {
    success: S.Void,
    payload: RoadmapColumnUpdate,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteRoadmapColumn", {
    success: S.Void,
    payload: RoadmapColumnDelete,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware)
) {}
