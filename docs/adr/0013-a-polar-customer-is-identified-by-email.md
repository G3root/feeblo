# ADR 0013: A Polar customer is identified by email, not by workspace

## Decision

Feeblo does not create Polar customers at signup. `createCustomerOnSignUp` stays off and the Polar better-auth plugin is registered for its signed webhook endpoint only. The workspace a subscription belongs to is the `metadata.org` key stamped on the checkout and carried back on every subscription payload; that key is the tenancy boundary, not the Polar customer.

`createCheckout` keeps passing `externalCustomerId: organizationId` and the buyer's email, with the understanding that the external id only names the customer a first checkout creates. Polar resolves a checkout customer by email before external id and allows one customer per email per merchant organization, so a buyer who pays for several workspaces shares one Polar customer and one portal session. That is a Polar constraint; Feeblo does not try to defeat it with synthetic emails.

## Why

The previous intent — "billing belongs to the workspace, not the person" — cannot be enforced through `externalCustomerId`. Polar's `_create_or_update_customer` looks a customer up by email first and only falls back to creating one with the external id when no email matches. A signup hook had already created a customer with the admin's email, so every workspace checkout reused that personal customer and the external id was ignored.

The failure that made this a decision rather than a note was on the other end of the lifetime. `@polar-sh/better-auth` deletes a customer on user deletion by listing customers with the user's email and deleting the first result — Polar sorts by newest first, so that is the workspace customer the checkout created. Polar cancels every billable subscription of a deleted customer. A member who paid for a workspace owned by teammates could therefore delete their account and silently cancel a subscription that was still in use. Disabling the signup hook removes the email-matched personal customer and disables the delete hook with it; `beforeDelete` in `packages/auth` already refuses to delete a workspace while a teammate remains, and the checkout's `metadata.org` keeps every subscription scoped to its workspace regardless of which customer carries it.

The cost is accepted: a buyer with several workspaces sees one portal for all of them. The alternative — one Polar customer per workspace — is not representable when the email must be unique per merchant organization, and inventing per-workspace emails would break receipts and dunning.

## Consequences

Deleting a user must never call Polar's customer delete. The only Polar deletion Feeblo performs is the per-subscription revocation in `PolarService.revokeSubscription`, driven by the durable queue in ADR 0014.

`WorkspacePlanGet`, entitlements, and every webhook read use the subscription's `organizationId` (decoded from `metadata.org`), never the customer. A subscription whose metadata has no string `org`, or whose `org` workspace no longer exists, is logged and acknowledged rather than retried: it belongs to no workspace this deployment can serve.

The portal is per customer, so an admin of workspace A with `billing.*` can see workspace B's subscription in the portal when both were bought with the same email. That is visible in the product and accepted here; the alternative is a Polar constraint Feeblo cannot remove.
