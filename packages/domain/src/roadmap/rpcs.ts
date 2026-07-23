import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../session-middleware";
import { RoadmapServiceErrors } from "./errors";
import { Roadmap, RoadmapList } from "./schema";

export class RoadmapRpcs extends RpcGroup.make(
  Rpc.make("RoadmapList", {
    success: S.Array(Roadmap),
    payload: RoadmapList,
    error: RoadmapServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RoadmapListPublic", {
    success: S.Array(Roadmap),
    payload: RoadmapList,
    error: RoadmapServiceErrors,
  })
  // Rpc.make("RoadmapCreate", {
  //   success: S.Void,
  //   payload: RoadmapCreate,
  //   error: RoadmapServiceErrors,
  // }).middleware(AuthMiddleware),
  // Rpc.make("RoadmapUpdate", {
  //   success: S.Void,
  //   payload: RoadmapUpdate,
  //   error: RoadmapServiceErrors,
  // }).middleware(AuthMiddleware),
  // Rpc.make("RoadmapDelete", {
  //   success: S.Void,
  //   payload: RoadmapDelete,
  //   error: RoadmapServiceErrors,
  // }).middleware(AuthMiddleware)
) {}
