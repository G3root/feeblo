import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
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
  Rpc.make("RoadmapColumnList", {
    success: S.Array(StatusRoadmapColumn),
    payload: RoadmapColumnList,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RoadmapColumnListPublic", {
    success: S.Array(StatusRoadmapColumn),
    payload: RoadmapColumnList,
    error: RoadmapColumnServiceErrors,
  }),
  Rpc.make("RoadmapColumnCreate", {
    success: S.Void,
    payload: RoadmapColumnCreate,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RoadmapColumnUpdate", {
    success: S.Void,
    payload: RoadmapColumnUpdate,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RoadmapColumnDelete", {
    success: S.Void,
    payload: RoadmapColumnDelete,
    error: RoadmapColumnServiceErrors,
  }).middleware(AuthMiddleware)
) {}
