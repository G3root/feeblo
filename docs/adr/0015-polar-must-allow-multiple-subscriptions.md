# ADR 0015: Polar must allow multiple subscriptions

## Decision

Feeblo requires the Polar organization setting **Settings → Subscriptions → Allow multiple subscriptions** to be enabled. `PolarService.getOrganizationSettings` reads it through the organization access token, and `initAuthHandler` logs a startup warning when the token's organization has it off.

## Why

Polar caps a customer at one billable subscription per organization by default. The rule is enforced at checkout update/confirm (`_validate_subscription_uniqueness` in Polar's checkout service): any existing `active`, `trialing`, or `past_due` subscription for the customer raises a 403 `AlreadyActiveSubscriptionError` ("You already have an active subscription."). The check runs on the hosted checkout page, after `checkouts.create` has already succeeded, so Feeblo's `BillingCheckout` returns a URL and the refusal is invisible to Feeblo's logs.

Feeblo resolves a checkout customer by email (ADR 0013), so one person's workspaces share a Polar customer. With the default setting that means a person can pay for only one workspace: the second checkout dies on Polar's page with no Feeblo-side explanation. Multi-workspace ownership is part of the product, so the default is a misconfiguration for any deployment that expects it.

## Consequences

A deployment that never sells a second workspace to the same buyer can leave the setting off; it loses nothing, and the startup warning is noise it can ignore. A deployment that does sell multiple workspaces must enable the setting. The warning names the setting and this ADR so an operator can fix it before a customer hits the wall.

The startup read never fails the boot: `readOrganizationSubscriptionSettings` is bounded by a five-second timeout, logs a failure, and returns `None`, which callers read as "no guard".

A server-side checkout pre-check is the escalation path if operators ignore the warning. It would look the customer up by email and list billable subscriptions before `checkouts.create`; it is not implemented because the pinned SDK cannot filter subscriptions by status (only the deprecated `active` flag, which excludes `past_due`), so the pre-check would be a partial duplicate of Polar's own rule.

## Related

- ADR 0013 fixes the customer identity this cap applies to.
- ADR 0014 owns what happens to a subscription when its workspace is deleted.
