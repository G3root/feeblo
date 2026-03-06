import { Schema } from "effect";

export class BillingCheckoutInput extends Schema.Class<BillingCheckoutInput>(
  "BillingCheckoutInput"
)({
  organizationId: Schema.String,
  productId: Schema.String,
}) {}

export class BillingCheckoutOutput extends Schema.Class<BillingCheckoutOutput>(
  "BillingCheckoutOutput"
)({
  url: Schema.String,
}) {}

