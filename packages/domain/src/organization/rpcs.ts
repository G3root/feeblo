import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { OrganizationServiceErrors } from "./errors";
import { Organization, OrganizationUpdate } from "./schema";

export class OrganizationRpcs extends RpcGroup.make(
  Rpc.make("OrganizationList", {
    success: Schema.Array(Organization),
    error: OrganizationServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("OrganizationUpdate", {
    success: Schema.Void,
    payload: OrganizationUpdate,
    error: OrganizationServiceErrors,
  }).middleware(AuthMiddleware)
) {}
