import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AuthMiddleware } from "../session-middleware";
import { MembershipServiceErrors } from "./errors";
import { Membership } from "./schema";

export class MembershipRpcs extends RpcGroup.make(
  Rpc.make("MembershipList", {
    success: Schema.Array(Membership),
    error: MembershipServiceErrors,
  })
).middleware(AuthMiddleware) {}
