import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
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
