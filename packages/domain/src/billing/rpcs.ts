import { Rpc, RpcGroup } from "@effect/rpc";
import { AuthMiddleware } from "../session-middleware";
import { BillingServiceErrors } from "./errors";
import { BillingCheckoutInput, BillingCheckoutOutput } from "./schema";

export class BillingRpcs extends RpcGroup.make(
  Rpc.make("BillingCheckout", {
    payload: BillingCheckoutInput,
    success: BillingCheckoutOutput,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware)
) {}

