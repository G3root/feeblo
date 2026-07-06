import * as S from "effect/Schema";

export const BillingCheckoutInput = S.Struct({
  organizationId: S.String,
  productId: S.String,
});

export type TBillingCheckoutInput = S.Schema.Type<typeof BillingCheckoutInput>;

export const BillingCheckoutOutput = S.Struct({
  url: S.String,
});

export type TBillingCheckoutOutput = S.Schema.Type<
  typeof BillingCheckoutOutput
>;

export const BillingPortalInput = S.Struct({
  organizationId: S.String,
});

export type TBillingPortalInput = S.Schema.Type<typeof BillingPortalInput>;

export const BillingPortalOutput = S.Struct({
  url: S.String,
});

export type TBillingPortalOutput = S.Schema.Type<typeof BillingPortalOutput>;
