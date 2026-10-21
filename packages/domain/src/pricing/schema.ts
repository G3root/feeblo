import * as S from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  type CapabilityFeatureKey,
  type LimitFeatureKey,
} from "../plan-entitlements";

export const PlanKey = S.Literals(["free", "starter", "professional"]);

export type TPlanKey = S.Schema.Type<typeof PlanKey>;

const PlanLimitsFields = {
  feedbackBoards: S.NullOr(S.Finite),
  members: S.NullOr(S.Finite),
  changelogCategories: S.NullOr(S.Finite),
  crmEntries: S.NullOr(S.Finite),
  workspaces: S.NullOr(S.Finite),
} satisfies { readonly [K in LimitFeatureKey]: S.Schema<number | null> };

/**
 * The wire shape. It tolerates two things, because `/api/plans` is HTTP-cached
 * for an hour and a client can decode a body served before a key existed or
 * before a key was renamed:
 *
 * - `privilegedMembers` is the old spelling of `members`, and a body from
 *   before the rename carries it and no `members`.
 * - `workspaces` was added after the endpoint shipped, so older bodies omit
 *   it entirely.
 *
 * Both are optional here and reconciled below; their values stay strictly
 * typed, so a malformed limit still fails to decode.
 */
const PlanLimitsWire = S.Struct({
  ...PlanLimitsFields,
  members: S.optionalKey(PlanLimitsFields.members),
  privilegedMembers: S.optionalKey(PlanLimitsFields.members),
  workspaces: S.optionalKey(PlanLimitsFields.workspaces),
});

/**
 * Decodes either spelling into one shape. A present `members` always wins,
 * including an explicit `null` ("unlimited"): only an absent key is derived
 * from the legacy one. A missing limit reads as `null`, matching "no cap",
 * and the decoded type stays `number | null`. Encoding emits the current keys.
 */
const PlanLimits = PlanLimitsWire.pipe(
  S.decodeTo(
    S.Struct(PlanLimitsFields),
    SchemaTransformation.transform({
      decode: (wire) => ({
        feedbackBoards: wire.feedbackBoards,
        members:
          wire.members !== undefined
            ? wire.members
            : (wire.privilegedMembers ?? null),
        changelogCategories: wire.changelogCategories,
        crmEntries: wire.crmEntries,
        workspaces: wire.workspaces ?? null,
      }),
      encode: (limits) => limits,
    })
  )
);

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
  publicApi: S.Boolean,
} satisfies { readonly [K in CapabilityFeatureKey]: S.Schema<boolean> });

export const PlanPrice = S.Struct({
  productId: S.String,
  amount: S.Finite,
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
