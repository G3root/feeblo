import * as S from "effect/Schema";

import {
  type CapabilityFeatureKey,
  type LimitFeatureKey,
} from "../plan-entitlements";

export const PlanKey = S.Literals(["free", "starter", "professional"]);

export type TPlanKey = S.Schema.Type<typeof PlanKey>;

const PlanLimits = S.Struct({
  feedbackBoards: S.NullOr(S.Number),
  privilegedMembers: S.NullOr(S.Number),
  changelogCategories: S.NullOr(S.Number),
  submissionNotificationRecipients: S.NullOr(S.Number),
  crmEntries: S.NullOr(S.Number),
} satisfies { readonly [K in LimitFeatureKey]: S.Schema<number | null> });

const PlanCapabilities = S.Struct({
  roadmap: S.Boolean,
  changelog: S.Boolean,
  unlimitedEndUsers: S.Boolean,
  unlimitedPosts: S.Boolean,
  privateBoards: S.Boolean,
  privateRoadmaps: S.Boolean,
  removeBranding: S.Boolean,
  subscriberEmails: S.Boolean,
  widgetSso: S.Boolean,
  integrations: S.Boolean,
} satisfies { readonly [K in CapabilityFeatureKey]: S.Schema<boolean> });

export const PlanPrice = S.Struct({
  productId: S.String,
  amount: S.Number,
  currency: S.String,
});

export type TPlanPrice = S.Schema.Type<typeof PlanPrice>;

export const PlanFeatureRow = S.Struct({
  key: S.String,
  label: S.String,
});

export const PlanPricing = S.Struct({
  key: PlanKey,
  name: S.String,
  // "Everything in Free, plus:" for higher plans; null for the first plan.
  includesLabel: S.NullOr(S.String),
  limits: PlanLimits,
  capabilities: PlanCapabilities,
  // Hand-authored display rows (see pricing/features.ts).
  features: S.Array(PlanFeatureRow),
  prices: S.Struct({
    month: S.NullOr(PlanPrice),
    year: S.NullOr(PlanPrice),
  }),
});

export type TPlanPricing = S.Schema.Type<typeof PlanPricing>;

export const PlansResponse = S.Struct({
  plans: S.Array(PlanPricing),
});

export type TPlansResponse = S.Schema.Type<typeof PlansResponse>;
