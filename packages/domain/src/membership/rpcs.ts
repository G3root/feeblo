import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { Membership } from "./schema";

export class MembershipRpcs extends RpcGroup.make(
  Rpc.make("MembershipList", {
    success: Schema.Array(Membership),
  })
).middleware(AuthMiddleware) {}
