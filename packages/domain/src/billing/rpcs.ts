import { Rpc, RpcGroup } from "@effect/rpc";
import { AuthMiddleware } from "../session-middleware";
import { BillingServiceErrors } from "./errors";
import {
  BillingCheckoutInput,
  BillingCheckoutOutput,
  BillingPortalInput,
  BillingPortalOutput,
} from "./schema";

export class BillingRpcs extends RpcGroup.make(
  Rpc.make("BillingCheckout", {
    payload: BillingCheckoutInput,
    success: BillingCheckoutOutput,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("BillingPortal", {
    payload: BillingPortalInput,
    success: BillingPortalOutput,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware)
) {}
