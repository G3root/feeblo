import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as S from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { RoadmapServiceErrors } from "./errors";
import {
  Roadmap,
  RoadmapCreate,
  RoadmapDelete,
  RoadmapList,
  RoadmapUpdate,
} from "./schema";

export class RoadmapRpcs extends RpcGroup.make(
  Rpc.make("ListRoadmaps", {
    success: S.Array(Roadmap),
    payload: RoadmapList,
    error: RoadmapServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListRoadmapsPublic", {
    success: S.Array(Roadmap),
    payload: RoadmapList,
    error: S.Union([RoadmapServiceErrors, RateLimitErrors]),
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateRoadmap", {
    success: S.Void,
    payload: RoadmapCreate,
    error: RoadmapServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateRoadmap", {
    success: S.Void,
    payload: RoadmapUpdate,
    error: RoadmapServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteRoadmap", {
    success: S.Void,
    payload: RoadmapDelete,
    error: RoadmapServiceErrors,
  }).middleware(AuthMiddleware)
) {}
