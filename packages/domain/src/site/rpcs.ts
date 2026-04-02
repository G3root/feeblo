import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { SiteServiceErrors } from "./errors";
import { Site, SiteList, SiteListBySubdomain, SiteUpdate } from "./schema";

export class SiteRpcs extends RpcGroup.make(
  Rpc.make("SiteList", {
    success: Schema.Array(Site),
    payload: SiteList,
    error: SiteServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SiteListBySubdomain", {
    success: Schema.Array(Site),
    payload: SiteListBySubdomain,
    error: SiteServiceErrors,
  }),
  Rpc.make("SiteUpdate", {
    success: Schema.Void,
    payload: SiteUpdate,
    error: SiteServiceErrors,
  }).middleware(AuthMiddleware)
) {}
