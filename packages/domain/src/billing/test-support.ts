import type { webhooks } from "@polar-sh/sdk/2026-10";

export type SubscriptionPayload =
  webhooks.WebhookSubscriptionCreatedPayload["data"];

/**
 * Builds a Polar subscription payload as the wire shape the SDK types, so a
 * fixture that drifts from the SDK contract fails to compile here instead of
 * silently escaping the repository's expectations. The SDK no longer ships a
 * runtime codec to decode a JSON fixture through, so the object literal is the
 * check.
 */
export const makeSubscriptionPayload = ({
  externalSubscriptionId,
  organizationId,
  status = "active",
  metadata,
  productId,
}: {
  externalSubscriptionId: string;
  organizationId: string;
  status?: SubscriptionPayload["status"];
  metadata?: SubscriptionPayload["metadata"];
  productId: string;
}): SubscriptionPayload => ({
  id: externalSubscriptionId,
  created_at: "2026-01-01T00:00:00.000Z",
  modified_at: null,
  amount: 2900,
  currency: "usd",
  recurring_interval: "month",
  recurring_interval_count: 1,
  status,
  current_period_start: "2026-01-01T00:00:00.000Z",
  current_period_end: "2026-02-01T00:00:00.000Z",
  current_meter_period_start: null,
  current_meter_period_end: null,
  trial_start: null,
  trial_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  started_at: null,
  ends_at: null,
  ended_at: null,
  pause_at_period_end: false,
  paused_at: null,
  resumes_at: null,
  customer_id: `cus_${externalSubscriptionId}`,
  product_id: productId,
  discount_id: null,
  checkout_id: null,
  seats: null,
  units: null,
  customer_cancellation_reason: null,
  customer_cancellation_comment: null,
  metadata: metadata ?? { org: organizationId },
  custom_field_data: {},
  customer: {
    id: `cus_${externalSubscriptionId}`,
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: null,
    metadata: {},
    external_id: organizationId,
    email: "user@example.com",
    email_verified: true,
    type: "individual",
    name: "Test User",
    billing_name: null,
    billing_address: null,
    tax_id: null,
    organization_id: "polar_org",
    deleted_at: null,
    first_user_event_at: null,
    avatar_url: null,
  },
  product: {
    id: productId,
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: null,
    trial_interval: null,
    trial_interval_count: null,
    name: "Starter monthly",
    description: null,
    visibility: "public",
    recurring_interval: "month",
    recurring_interval_count: 1,
    meter_interval: null,
    meter_interval_count: null,
    is_recurring: true,
    is_archived: false,
    organization_id: "polar_org",
    metadata: { plan: "starter", variant: "monthly" },
    is_deletable: true,
    prices: [],
    benefits: [],
    medias: [],
    attached_custom_fields: [],
  },
  discount: null,
  prices: [],
  meters: [],
  pending_update: null,
});
