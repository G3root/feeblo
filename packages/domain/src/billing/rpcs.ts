import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { BillingServiceErrors } from "./errors";
import {
  BillingCheckoutConfirmationInput,
  BillingCheckoutInput,
  BillingCheckoutOutput,
  BillingPortalInput,
  BillingPortalOutput,
} from "./schema";

export class BillingRpcs extends RpcGroup.make(
  Rpc.make("CreateBillingCheckout", {
    payload: BillingCheckoutInput,
    success: BillingCheckoutOutput,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateBillingPortal", {
    payload: BillingPortalInput,
    success: BillingPortalOutput,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ConfirmBillingCheckout", {
    payload: BillingCheckoutConfirmationInput,
    success: Schema.Void,
    error: BillingServiceErrors,
  }).middleware(AuthMiddleware)
) {}
