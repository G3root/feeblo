import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { SiteServiceErrors } from "./errors";
import {
  Site,
  SiteHidePoweredByBranding,
  SiteList,
  SiteListBySubdomain,
  SiteUpdate,
} from "./schema";

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
  }).middleware(AuthMiddleware),
  Rpc.make("SiteHidePoweredByBranding", {
    success: Schema.Void,
    payload: SiteHidePoweredByBranding,
    error: SiteServiceErrors,
  }).middleware(AuthMiddleware)
) {}
