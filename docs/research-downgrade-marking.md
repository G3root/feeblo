# Research: marking an org as downgraded for integration cleanup

> **Status:** research only — no code changes. Primary sources cited inline as `path:line` or official URL. Secondary summaries were not used.

## TL;DR recommendation

**Do not add a persisted `downgraded` boolean or timestamp column.** Compute downgrade state as a **derived, read-time view** from the existing `subscriptionTable` + `productTable.metadata.plan` join, extended with a lightweight **over-limit count query** for integrations. Persisted flags create a second source of truth that drifts with Polar webhook ordering; the current derived plan resolver already handles grace periods, `cancel_at_period_end`, and `past_due` correctly and is the precedent for every other entitlement.

Where the UI needs to say "you are downgraded — delete X integrations to continue", return a **derived DTO** from `EntitlementPolicy` (or a thin `WorkspaceRepository` helper) and expose it through the existing `WorkspacePlanGet` RPC response. For the downgraded side-effect on integration _data itself_, follow the existing **email `paused_by_plan`** precedent (`packages/domain/src/email-outbox/workflow.ts:108-130`, `packages/domain/src/email-subscription/repository.ts:580-630`): **pause deliveries, keep connections readable, require manual deletion** — never auto-delete or soft-delete.

Concretely:

1. Extend `WorkspaceRepository.findPlanByOrganizationId` (or a new `findDowngradeState`) to return `{ plan, subscription, isDowngraded, downgradeDetails }` where `isDowngraded` is `true` iff `plan === "free"` **and** an integration/privileged-member/board count exceeds the free entitlement.
2. Extend `EntitlementPolicy` with `getDowngradeState(organizationId)` that joins plan + live counts — the single call site for the downgrade view.
3. Add an entitlement gate to integration _creation_ (missing today) and add a pause gate to integration _delivery_ (re-use `integration_connection.lifecycle = "paused"`), mirroring email materialization gating.
4. Surface via a **non-blocking banner** on `/$organizationId/settings/*` plus a **per-connection list** on `/$organizationId/settings/integrations` with explicit `Delete` actions. Do not block unrelated settings or navigation.

The rest of this doc justifies that choice against the code.

---

## 1. How billing and plan resolution actually work today (primary sources)

### 1.1 Schema is the source of truth for subscription state

`packages/db/src/schema/auth.ts:211-300` defines the persisted Polar subscription projection:

```ts
export const subscriptionTable = pgTable("subscription", {
  id: text("id").primaryKey(),
  externalId: text("external_id").unique().notNull(), // Polar id
  organizationId: text("organization_id") …,
  status: text("status").$type<"incomplete"|"incomplete_expired"|"trialing"|"active"|"past_due"|"canceled"|"unpaid">().notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull(),
  currentPeriodStart: timestamp("current_period_start") …,
  currentPeriodEnd: timestamp("current_period_end") …,
  canceledAt: timestamp("canceled_at") …,
  endsAt: timestamp("ends_at") …,
  endedAt: timestamp("ended_at") …,
  currentPeriodEnd: timestamp("current_period_end") …,
  …
});
```

`productTable` (`packages/db/src/schema/auth.ts:305-360`) stores `metadata: { plan: "starter"|"professional", variant: "monthly"|"yearly" }` as JSONB (`packages/domain/src/billing/repository.ts:140-160` for decode). No `downgraded` column exists anywhere; exhaustive grep for `over.limit`, `overLimit`, `downgrade`, `grace` in `packages/` returns only unrelated widget/webhook grace-period references — **no prior downgrade concept** (`grep -rn "downgrade"` in `packages/domain/src` yields zero hits).

### 1.2 Plan is derived at read time, not persisted on `organization`

`packages/domain/src/workspace/repository.ts:234-280`:

```ts
findPlanByOrganizationId: (args) =>
  db
    .select({
      organizationId: subscriptionTable.organizationId,
      plan: productTable.metadata,
    })
    .from(subscriptionTable)
    .innerJoin(productTable, eq(productTable.id, subscriptionTable.productId))
    .where(
      and(
        eq(subscriptionTable.organizationId, args.organizationId),
        or(
          inArray(subscriptionTable.status, ["active", "trialing"]),
          and(
            eq(subscriptionTable.status, "past_due"),
            gt(subscriptionTable.currentPeriodEnd, now)
          )
        )
      )
    )
    .orderBy(
      desc(subscriptionTable.currentPeriodEnd),
      desc(subscriptionTable.createdAt)
    )
    .limit(1)
    .pipe(
      Option.match({
        onNone: () => "free",
        onSome: (s) => s.plan?.plan ?? "free",
      })
    );
```

Identical predicate lives in `packages/domain/src/billing/repository.ts:33-37` as `currentlyEntitledSubscription(now)` and is reused by `findCurrentSubscriptionByOrganizationId` (`packages/domain/src/billing/repository.ts:187-260`). The fallback is unconditionally `"free"` — there is no downgraded variant.

Key implications for a downgrade mark:

- **No write is needed to downgrade.** Deleting or expiring the entitled subscription row is enough; every call to `findPlanByOrganizationId` immediately resolves to `"free"`.
- `canceledAt` / `endsAt` / `endedAt` / `cancelAtPeriodEnd` are **not consulted** by the plan resolver. Only `status` + `currentPeriodEnd` matter. `cancelAtPeriodEnd = true` with `status = "active"` and a future `currentPeriodEnd` is still entitled (delayed downgrade).
- `past_due` is a built-in grace: entitled while `currentPeriodEnd > now`, free after (`packages/domain/src/workspace/handlers.test.ts:507-540`, `packages/domain/src/workspace/repository.ts:256-257`).

### 1.3 Polar webhook handling is idempotent upsert on `external_id`

`packages/auth/src/server.ts:543-590` wires Polar through `@polar-sh/better-auth`'s `polar()` + `webhooks()` plugins:

```ts
onPayload: async (payload) => {
  switch (payload.type) {
    case "product.created":
    case "product.updated":
      await billingRepository.upsertProduct(payload.data);
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
    case "subscription.revoked":
    case "subscription.uncanceled":
    case "subscription.active":
      await billingRepository.upsertSubscription(payload.data);
  }
};
```

`packages/domain/src/billing/repository.ts:92-145` implements `upsertSubscription` as `INSERT … ON CONFLICT (externalId) DO UPDATE` with `updatedAt = now`, and `createSubscription` as `ON CONFLICT DO NOTHING`. Product upsert is analogous (`packages/domain/src/billing/repository.ts:175-188`). Better-auth verifies the webhook signature using `POLAR_WEBHOOK_SECRET` (`packages/auth/src/server.ts:551-553`, `packages/domain/src/billing/config.ts:4-32`).

Ordering consequences:

- Webhooks are **at-least-once, unordered**. `subscription.canceled` can arrive before `subscription.updated` that set `currentPeriodEnd`. The resolver's `ORDER BY currentPeriodEnd DESC, createdAt DESC` makes the _latest-period_ row win regardless of arrival order.
- Idempotency key is `externalId` — replaying the same Polar delivery is a no-op update, not a duplicate row.
- Any _extra_ persisted downgrade flag would need its own idempotency and ordering logic, re-implementing what `externalId` already gives us.

### 1.4 Polar/Stripe best practice for downgrade (primary docs)

For subscription downgrade/cancel semantics the canonical references are:

- **Stripe:** `cancel_at_period_end` — "If `cancel_at_period_end` is `true`, the subscription remains active until the end of the period" — `https://docs.stripe.com/api/subscriptions/object#subscription_object-cancel_at_period_end` and cancel guide `https://docs.stripe.com/billing/subscriptions/cancel`. Webhook sequence is `customer.subscription.updated` (`cancel_at_period_end: true`) → later `customer.subscription.deleted` / `status: canceled` after `current_period_end`.
- **Polar:** `subscription.updated` / `subscription.canceled` / `subscription.revoked` webhooks carry `status`, `cancelAtPeriodEnd`, `currentPeriodEnd`, `canceledAt`, `endsAt` mirroring Stripe shape. Official reference: `https://docs.polar.sh/api-reference/webhooks` and Polar SDK `WebhookSubscriptionCreatedPayload` type imported in `packages/domain/src/billing/repository.ts:3-4` (`@polar-sh/sdk`).

Both vendors recommend: **do not proactively set a downgraded flag on `updated(cancel_at_period_end=true)`; treat the subscription as active until `current_period_end`**. Feeblo already follows this — the derived resolver does exactly that.

---

## 2. Entitlement enforcement patterns (primary sources)

`packages/domain/src/entitlement/policies.ts:45-270` is the single backend entitlement gate. Every limit/capability check is a **read-time derivation** from `findPlanByOrganizationId` + `PLAN_ENTITLEMENTS[plan]`:

```ts
const findEntitlements = (organizationId) =>
  workspaceRepository
    .findPlanByOrganizationId({ organizationId })
    .pipe(map((s) => ({ ...s, entitlements: PLAN_ENTITLEMENTS[s.plan] })));
```

Pattern per limit (all identical shape):

| Gate | File | Shape |
| --- | --- | --- |
| `canCreateBoard` | `packages/domain/src/entitlement/policies.ts:71-100` | `findEntitlements` + `yield* boardCount` + `if limit !== null && count >= limit → PolicyDenied` |
| `canAssignPrivilegedRole` | `packages/domain/src/entitlement/policies.ts:153-176` | `privilegedMemberCount + pendingPrivilegedInvitations` vs `privilegedMembers` limit |
| `canCreateChangelogCategory` | `packages/domain/src/entitlement/policies.ts:177-199` | categoryCount vs `changelogCategories` |
| `canCreateCrmEntry` | `packages/domain/src/entitlement/policies.ts:200-218` | crmEntryCount vs `crmEntries` |
| `mayMaterializeEmailIntent` | `packages/domain/src/entitlement/policies.ts:230-245` | boolean `subscriberEmails` capability — no count, just `entitlements.capabilities.subscriberEmails` |
| `canUsePrivateBoards` / `canUsePrivateRoadmaps` / `canUseWidgetSso` / `canHidePoweredByBranding` | `packages/domain/src/entitlement/policies.ts:60-150` | single capability boolean |

Call sites compose these into **policy layers** via `Policy.all(...)`:

- `packages/domain/src/board/policies.ts:30-41` — `Policy.canPermission("boards.create")` **and** `canCreateBoard({ boardCount })`
- `packages/domain/src/roadmap/policies.ts:29-35` — permission **and** `canCreateRoadmap`
- `packages/domain/src/changelog-category/policies.ts:18-25` — same
- `packages/domain/src/membership/policies.ts:83-110` — `canAssignPrivilegedRole` via `countPrivilegedMembers + countPendingPrivilegedInvitations`

There is **no persisted over-limit row**. Even when a workspace is already over-limit (e.g., downgraded from 5 boards to 2), the backend still resolves plan as `"free"` and the next `BoardCreate` fails with `PolicyDenied: "The free plan allows up to 2 feedback boards."` Existing boards are **not deleted** and remain readable — the UI shows them, creation is blocked (see §4).

This is the exact precedent for integrations: a derived limit + blocking gate at create time, not a persisted downgrade flag.

---

## 3. How integrations are gated today (primary sources)

### 3.1 Permission vs capability: two orthogonal gates

- **Permission gate — who may manage:** `packages/permissions/src/permissions.ts:47` defines `integrations.manage`; `packages/permissions/src/role-permissions.ts:47` grants it only to `admin`/`owner` (via `manager` → `admin` inheritance). Every integration RPC composes it:

  - `integrations/slack/src/slack-rpc-handlers.ts:11` — `Policy.canPermission(orgId, "integrations.manage")`
  - `integrations/discord/src/discord-rpc-handlers.ts:11` — same
  - `integrations/github/src/github-rpc-handlers.ts:11` — same
  - `packages/domain/src/integration/external-resource/handlers.ts:18` — same
  - `integrations/webhook/src/webhook-rpc-handlers.ts:10` — uses `webhooks.manage` (companion permission, same roles)

- **Capability gate — whether the plan allows it:** `packages/domain/src/plan-entitlements.ts:113-165` defines `integrations: true` on `starter`/`professional`, `false` on `free`. It is **presently not checked server-side on integration creation** — no `canUseIntegrations` exists in `packages/domain/src/entitlement/policies.ts`, and none of the four integration handler files imports `EntitlementPolicy`. The only enforcement is client-side: `apps/web/src/dashboard/features/integrations/components/integration-card.tsx:67-110` reads `entitlements.capabilities.integrations` to decide `resolveActionMode(connected, entitled)` → `"locked"` (shows an `Upgrade` button) vs `"connect"` vs `"configure"`.

Gap: a free-plan workspace can still hit the RPC directly and connect Slack because the backend only checks `integrations.manage`. Adding a downgrade mark without fixing that gap would be moot.

### 3.2 Connection / route / delivery lifecycle (for pause-vs-delete)

`packages/db/src/schema/integration.ts:43-240` + `packages/domain-contracts/src/integration.ts:58-110`:

- `integration_connection.lifecycle`: `connecting | active | paused | reauth_required | disconnecting | disconnected | revocation_unconfirmed | archived`
- `integration_route.enabled: boolean` + `integration_delivery.state: pending | leased | succeeded | exhausted | canceled`

`paused` already exists as a lifecycle. Email downgrade precedent maps cleanly: when `subscriberEmails` becomes false, work is paused (`paused_by_plan`) without deleting subscriptions (`packages/domain/src/email-outbox/workflow.ts:122-170`, `packages/domain/src/email-subscription/repository.ts:580-630`). Deliveries are not retried until `eligible` again; reconciliation re-queues them (`packages/domain/src/email-outbox/workflow.ts:1197-1250`).

Integrations can reuse the same shape: when `entitlements.capabilities.integrations === false`, **pause deliveries** (`state = canceled` with a terminal reason **or** lifecycle = `paused`) and surface a banner — identical to the email `mayMaterializeEmailIntent` check in `sendDeliveryAttempt` (`packages/domain/src/email-outbox/workflow.ts:534-600`).

No code today deletes integration rows on plan change; `integration_connection` / `integration_route` are only removed by explicit user action (disconnect / remove endpoint — `integrations/webhook/src/webhook-management-live.ts:603-670`, etc.).

---

## 4. How the UI currently handles over-limit / entitlement failures (primary sources)

All over-limit handling is **derived, optimistic, and non-blocking** at read time. No persisted flag.

| Feature | Where limit is derived | What UI shows at limit | Backend gate |
| --- | --- | --- | --- |
| Boards | `apps/web/src/dashboard/features/board/components/create-board-dialog.tsx:63-110` — `boardCount = liveQuery(boards).length`, `atBoardLimit = boardLimit !== null && count >= limit` | `Empty` with "Board limit reached" + `Upgrade plan` button that toggles `UpgradePlanDialog` | `BoardPolicy.canCreate` → `EntitlementPolicy.canCreateBoard` (`packages/domain/src/board/policies.ts:30-41`) |
| Private boards/roadmaps flag | `apps/web/src/dashboard/features/board/components/board-visibility-field.tsx:18`, `…/roadmap-visibility-field.tsx:18` — `useEntitlements()` → `entitlements.capabilities.privateBoards` | disables private toggle / shows upgrade nudge | `EntitlementPolicy.canUpdateBoardVisibility` (`packages/domain/src/board/policies.ts:54-67`) |
| Changelog categories | `apps/web/src/dashboard/features/changelog-category/components/changelog-category-settings-table.tsx:35-50` — `PLAN_ENTITLEMENTS` import | upgrade prompt at limit (mirrors board) | `ChangelogCategoryPolicy.canCreate` (`packages/domain/src/changelog-category/policies.ts:18-25`) |
| CRM entries | `apps/web/src/dashboard/features/contact/components/crm-entries-usage.tsx` (lists usage), `contact-create-dialog.tsx:76` | usage bar + blocked create | `EntitlementPolicy.canCreateCrmEntry` (`packages/domain/src/contact/policies.ts:61`) |
| Integrations card | `apps/web/src/dashboard/features/integrations/components/integration-card.tsx:67-110` — `useEntitlements()` + `resolveActionMode` | `"locked"` → `ProLockedButton` that opens `UpgradePlanDialog`; when connected shows `Configure` even on free | **Missing server gate** (see §3) |
| Plan display | `apps/web/src/dashboard/hooks/use-plan.ts:7`, `hooks/use-entitlements.ts:8-14`, `lib/collections.ts:workspacePlanCollection` — `useLiveQuery(workspacePlanCollection where orgId)` → `PLAN_ENTITLEMENTS[plan]` | `BillingSettingsPage` (`apps/web/src/dashboard/routes/$organizationId/settings/billing.tsx:38-130`) shows Current Plan badge + `Manage Billing` | `WorkspacePlanGet` RPC (`packages/domain/src/workspace/handlers.ts:35-45`, `rpcs.ts:11`) |
| Upgrade entry | `apps/web/src/dashboard/features/billing/components/upgrade-dialog.tsx:10-80`, `lib/checkout.ts` | modal with plan cards vs portal redirect when already paid | `BillingCheckout` / `BillingPortal` (`packages/domain/src/billing/handlers.ts:13-80`) |
| Privileged members | `apps/web/src/dashboard/hooks/use-privileged-member-limit.ts:7-16` | invite button disabled at limit | `MembershipPolicy.canAssignPrivilegedRole` (`packages/domain/src/membership/policies.ts:83-110`) |

Key patterns the downgrade UI should reuse:

- **Live count + entitlement** derived on the client via `useLiveQuery` + `useEntitlements()` — no polling flag.
- **Empty/upsell state** inside the creation dialog, not a global block.
- **Plan collection** (`apps/web/src/dashboard/lib/collections.ts:workspacePlanCollection`) uses `staleTime: POSITIVE_INFINITY` + `queryKey: organizationScopedQueryKey("workspace-plan")` with explicit `refetch()` after checkout (`…/settings/billing.tsx:110-145` polls for 30s). Same polling pattern can refresh downgrade state after webhook lands.

No blocking modal exists today; the closest is the session-level auth gate (`apps/web/src/dashboard/features/auth/components/organization-auth-gate.tsx`).

---

## 5. What a "downgraded" mark is really asking for

Two separate concerns are being conflated:

1. **Entitlement loss** — `plan` flipped from `starter|professional` → `free` because the entitled subscription row is gone or expired. This is already derived (§1.2) and must remain the source of truth.
2. **Over-limit residue** — the org now _holds_ more state than the free plan allows (e.g., 3 Slack connections when `integrations` is `false`, 3 private boards, 4 privileged members). The UI needs to say _"you have N things that require a paid plan — delete/convert N−limit of them"_.

Only (2) needs new logic. A plain `downgraded: boolean` collapses both and forces callers to guess _what_ is over-limit. A persisted `downgraded_at` collapses further by adding a timestamp nobody needs — `currentPeriodEnd` is already the downgrade _effective_ time.

---

## 6. Strategy options — evaluated against the codebase

### 6.1 Option matrix

| # | Strategy | Where computed | Persistence | Handles delayed downgrade (`cancel_at_period_end = true`) | Surfaces _which_ integrations to delete | Idempotency / ordering risk | Drift risk | Cost |
| --- | --- | --- | --- | --- | --- | --- | --: | --- |
| **A** | **Derived flag + derived over-limit view (recommended)** | `EntitlementPolicy.getDowngradeState` / `WorkspaceRepository` helper, returned via extended `WorkspacePlanGet` | None (read-time join) | ✔ — derived resolver keeps `active` until `currentPeriodEnd`, so `isDowngraded` stays false during the grace window | ✔ — counts `integration_connection` where `lifecycle ∈ {active, paused}` + optionally `integration_route.enabled` | None — no write to order; reuses Polar `externalId` idempotency | None — single source of truth (subscription row) | One extra `COUNT(*)` query per downgrade view (or via existing live queries) |
| B | Persisted `organization.downgraded` boolean set by webhook handler | `packages/auth/src/server.ts:onPayload` | Migration + column | ✘/fragile — must decide whether `updated(cancel_at_period_end=true)` sets it now or at `currentPeriodEnd`; either choice contradicts Stripe/Polar guidance | ✘ — still need counts; boolean alone is insufficient for the delete list | High — `subscription.updated` vs `subscription.canceled` reordering can leave flag stale; needs compensating job | High — flag can desync if webhook is missed or retried after DB transaction rolls back | Migration + backfill |
| C | Persisted `downgradedAt` / grace-period timestamp on `organization` | Same as B | Migration + column | Partial — timestamp gives a grace window but dupes `currentPeriodEnd` | ✘ | Same ordering risk + extra timestamp interpretation | High | Migration + interpret `downgradedAt` vs `currentPeriodEnd` ambiguity |
| D | Persisted over-limit JSON snapshot (`organization.downgradeMeta = { integrations: 3, boards: 5, … }`) | Webhook handler + reconciliation cron | Migration + column | Fragile — snapshot goes stale as user deletes integrations without tipping a webhook | ✔ for snapshot moment, ✘ moments later | Highest — snapshot must be re-derived on every integration-board-member mutation, not just billing webhooks | Highest — snapshot drifts the instant any count changes | Migration + mutation hooks in every `*Repository` |
| E | Soft-delete / auto-pause integrations in the webhook handler | Webhook handler issues `UPDATE integration_connection SET lifecycle='paused'` | Writes connections | ✔ but surprising — violates Stripe/Polar expectation that `cancel_at_period_end` keeps service until period end | ✔ (remaining `active` list) | High — handler must be transactional with subscription upsert; failure mid-flight leaves partial pause | Medium — legitimate admin can no longer tell what they had | Destructive; breaks audit (`post_external_resource_link` integrity) |
| F | Auto-delete integrations on downgrade | Webhook handler deletes rows | Deletes rows | ✘ — destructive + violates at-least-once webhook dedup (retrying `subscription.canceled` would 404 on second pass) | — | Highest | Highest | Data loss; contradicts email precedent which never deletes `email_subscription` |

### 6.2 Why A wins — code-grounded reasons

1. **Single source of truth stays `subscriptionTable`.** Every other cap (`feedbackBoards`, `privilegedMembers`, `changelogCategories`) is enforced by a derived limit check. Adding a persisted flag uniquely for integrations would make the permission table inconsistent and would require a new invariant check in `coding-standards` ("never duplicate the role/plan literal") to also cover plan state.

2. **No migration, no backfill, no data repair.** The fallback `onNone: () => "free"` (`packages/domain/src/workspace/repository.ts:272`) already backfills: any org without an entitled subscription _is_ free. A persisted column needs a backfill for every existing org + a one-off job for the `past_due` edge case.

3. **Delayed downgrade just works.** `cancelAtPeriodEnd = true` + `status = "active"` is still entitled until `currentPeriodEnd` (`packages/domain/src/billing/repository.ts:33-37`). During that window the user can still use integrations without a faux "downgraded but still entitled" contradiction. For an _informational_ "downgrade scheduled" banner you can read `cancelAtPeriodEnd` + `currentPeriodEnd` directly — no flag required:

   ```ts
   // pseudo
   const sub = await billingRepo.findSubscriptionByOrganizationId({
     organizationId,
   });
   const scheduledDowngrade =
     sub?.cancelAtPeriodEnd &&
     sub.status === "active" &&
     sub.currentPeriodEnd > now;
   ```

4. **Reconciliation precedent.** Email downgrade already uses derived `mayMaterializeEmailIntent` + `paused_by_plan` reversible states with a reconciliation loop (`packages/domain/src/email-outbox/workflow.ts:1197-1250`, `packages/domain/src/email-subscription/repository.ts:580-650`). That loop exists precisely because a persisted flag cannot keep up with plan flips + idempotent delivery. Integrations should copy it: **pause deliveries when `integrations` capability is false, resume when true** — no persisted org flag.

5. **The delete list needs counts, not a boolean.** The UI ask is "show downgrade actions (e.g., deleting integrations)". A boolean cannot produce the list; an over-limit view can. The cheapest over-limit view is `SELECT count(*) FROM integration_connection WHERE organizationId = ? AND lifecycle IN ('active','paused')` and comparing against the derived limit (for `integrations` the free limit is effectively `0` connections — see `PLAN_ENTITLEMENTS.free.capabilities.integrations === false` in `packages/domain/src/plan-entitlements.ts:142-144`). That count already exists as an index (`integration_connection_organization_lifecycle_idx` in `packages/db/src/schema/integration.ts:91-94`).

---

## 7. Detailed design for the recommended derived approach

### 7.1 Domain layer — where to compute

Three plausible homes; ranked:

#### Preferred: `EntitlementPolicy.getDowngradeState(organizationId)`

```
packages/domain/src/entitlement/policies.ts  — add:

export type DowngradeState = {
  plan: OrganizationPlan          // "free" | "starter" | "professional"
  isDowngraded: boolean           // plan === "free" && overLimit
  overLimit: {
    integrations: { count: number; limit: number | null; allowed: boolean } // limit = 0 when integrations === false
    feedbackBoards: { count: number; limit: number | null }
    privilegedMembers: { count: number; limit: number | null }
    // add others as needed
  }
  scheduledDowngrade: null | { currentPeriodEnd: Date; cancelAtPeriodEnd: boolean } // for cancel_at_period_end banner
  effectiveAt: Date               // now snapshot time, or subscription.currentPeriodEnd when past_due
}
```

Why this home: it already owns `findEntitlements` (`packages/domain/src/entitlement/policies.ts:48-58`) and composes repository counts. It is the only place that knows both `PLAN_ENTITLEMENTS` and live counts, so the check `entitlements.capabilities.integrations === false && integrationCount > 0` lives next to the existing `canCreateBoard` pattern. All RPC handlers already depend on `EntitlementPolicy` via `Layer.provide` (e.g., `packages/domain/src/board/handlers.ts:121`, `packages/domain/src/workspace/handlers.test.ts:507` fixture).

Alternative — `WorkspaceRepository.findDowngradeState` — is plausible if the team wants to keep `EntitlementPolicy` capability-only, but it would need to import `PLAN_ENTITLEMENTS` there, which it currently does not (`packages/domain/src/workspace/repository.ts:238-280` is pure SQL). Prefer keeping the join in the policy layer.

Do **not** compute only in the API response mapper (e.g., inside `packages/domain/src/workspace/handlers.ts`). That duplicates the rule for any other consumer (email reconciliation, integration delivery worker). Domain stays the owner.

### 7.2 Repository helper — counts

Add to `WorkspaceRepository` or a small `IntegrationCountsRepository`:

```ts
countActiveIntegrationsByOrganizationId: (args) =>
  db
    .select({ count: count() })
    .from(integrationConnectionTable)
    .where(
      and(
        eq(integrationConnectionTable.organizationId, args.organizationId),
        inArray(integrationConnectionTable.lifecycle, [
          "active",
          "paused",
          "connecting",
        ])
      )
    );
```

Index `integration_connection_organization_lifecycle_idx` already covers this (`packages/db/src/schema/integration.ts:91-94`). For per-provider breakdown, add `provider` to the SELECT and group.

### 7.3 RPC / API surface — how to surface

Extend `WorkspacePlanGet`'s success schema rather than adding a new RPC. `packages/domain/src/workspace/schema.ts:5-11` currently:

```ts
export const WorkspacePlan = S.Struct({
  organizationId: S.String,
  plan: S.Literals(["free", "starter", "professional"]),
});
```

Proposed extension (additive, non-breaking with `S.optional` + defaults):

```ts
export const WorkspacePlan = S.Struct({
  organizationId: S.String,
  plan: S.Literals(["free", "starter", "professional"]),
  // new, optional so old clients keep working
  downgradeState: S.optional(
    S.Struct({
      isDowngraded: S.Boolean,
      integrationCount: S.Number,
      integrationLimit: S.NullOr(S.Number), // null = unlimited, 0 = not allowed
      scheduled: S.NullOr(
        S.Struct({
          currentPeriodEnd: S.DateFromString,
          cancelAtPeriodEnd: S.Boolean,
        })
      ),
    })
  ),
});
```

`WorkspaceRpcHandlersEffect.WorkspacePlanGet` (`packages/domain/src/workspace/handlers.ts:35-45`) would call `entitlementPolicy.getDowngradeState` and return the enriched shape. Frontend `workspacePlanCollection` (`apps/web/src/dashboard/lib/collections.ts:workspacePlanCollection`) and `useEntitlements()` (`apps/web/src/dashboard/hooks/use-entitlements.ts:8-14`) automatically pick it up — no new collection needed.

Alternative: return a separate `DowngradeStateGet` RPC. Rejected: it would duplicate the `findPlanByOrganizationId` join and force the dashboard to fire two queries for one banner.

### 7.4 Handling of `cancel_at_period_end` / `past_due` grace

Do not treat these as downgraded. Truth table for `isDowngraded`:

| Subscription row | `currentlyEntitledSubscription(now)` | Derived `plan` | `cancelAtPeriodEnd` | `isDowngraded` |
| --- | --- | --- | --- | --- |
| `status=active`, `currentPeriodEnd = +30d`, `cancelAtPeriodEnd=false` | true | `starter` | false | false |
| `status=active`, `currentPeriodEnd = +14d`, `cancelAtPeriodEnd=true` | true | `starter` | true | **false** (show "Downgrade on Jan 14" banner, integrations still work) |
| `status=past_due`, `currentPeriodEnd = +5d` | true | `starter` | * | false (grace) |
| `status=past_due`, `currentPeriodEnd = -1d` | false | `free` | * | true if `integrationCount > 0` |
| `status=canceled`, `currentPeriodEnd = -1d` | false | `free` | — | true if `integrationCount > 0` |
| No subscription row | fallback | `free` | — | true if `integrationCount > 0` |

Eligibility check stays `entitlements.capabilities.integrations === false && count > 0`. A scheduled downgrade can optionally surface a _warning_ banner: "Your plan will change to Free on {currentPeriodEnd.toLocaleDateString()} — disconnect {n} integrations before then or they'll be paused."

### 7.5 What to do with existing integrations when `plan` flips to `free`

**Keep, pause, require manual delete.** Mirrors email `paused_by_plan` (non-destructive, reversible).

| Concern | Action on flip to `free` | Reason |
| --- | --- | --- |
| `integration_connection` rows | Leave as `active`, but **pause outbound deliveries** | Never delete user data on a billing event; Polar webhooks are at-least-once — deleting is non-idempotent |
| `integration_route` rows | Leave `enabled = true` (preserve user config), but skip delivery creation in `integration-delivery-postgres-repository` when `!entitled` | Preserves exact channel / event-type config for restore on upgrade |
| `integration_delivery` in flight | Gate in the worker: before `claimDeliveryForSending`, check `mayUseIntegrations(orgId)` (new `EntitlementPolicy.mayUseIntegrations`). If false, transition to `canceled` with `lastError: { errorTag: "paused_by_plan" }` and `nextAttemptAt = null` | Same shape as `EmailOutboxWorkflow`'s `mayMaterializeEmailIntent` gate (`packages/domain/src/email-outbox/workflow.ts:108-170`) + `sendDeliveryAttempt`'s `paused_by_plan` branch |
| Inbound (Slack commands / Discord interactions / GitHub webhooks) | Optionally still accept but do not write derived side-effects (or answer with ephemeral "Reconfigure required after plan change") | Inbound is less costly; preference is to keep receiving but not mutate, so restore is loss-less |
| UI | Show banner + list; `Delete` action per connection calls existing `removeEndpoint` / `disconnect` flow (`integrations/webhook/src/webhook-management-live.ts:603`, `integrations/slack/src/slack-connection-service.ts:433`, etc.) | Reuses existing destructive, user-initiated path with correct cascades (routes, deliveries) |

Never auto-delete on downgrade — the email precedent explicitly reconciles `active ↔ paused_by_plan` both ways (`packages/domain/src/email-subscription/repository.ts:591-650`, `packages/domain/src/email-outbox/workflow.ts:1197-1250`). For integrations, reconciliation re-queues `canceled(paused_by_plan)` deliveries when entitlements return.

### 7.6 Idempotency & webhook ordering

Because downgrade state is derived, there is **no new idempotency key to manage**. Existing guarantees suffice:

- Polar webhook replays: `ON CONFLICT (externalId)` upsert (`packages/domain/src/billing/repository.ts:125-145`). Replaying `subscription.canceled` ten times leaves the row identical.
- Out-of-order Polar writes: `ORDER BY currentPeriodEnd DESC` makes the _chronologically latest_ subscription win, not the _arrival_ latest. A late-arriving `subscription.updated(cancel_at_period_end=true, currentPeriodEnd=+14d)` correctly outranks an earlier `subscription.canceled(currentPeriodEnd=-1d)` if the latter's period is stale — if Polar emits them in the opposite order theCanceled row's later `currentPeriodEnd` still wins. No downgrade flag to manually sequence.
- Reconciliation safety: email's `reconcileSubscriptionPlanStates` + `resumePausedDeliveries` band (`packages/domain/src/email-outbox/workflow.ts:1197-1250`) runs even if a webhook is missed; the same band should be wired for integrations (see §7.8).

If a persisted flag were added, the handler would need to compare `payload.currentPeriodEnd` against the stored flag's time and ignore stale updates — re-implementing the `ORDER BY` in imperative code.

---

## 8. How to surface required actions in the UI (primary sources)

Reuse the existing dashboard conventions (§4). No new framework.

### 8.1 Banner (global, non-blocking)

- **Location:** `SettingsLayout.Header` (`apps/web/src/dashboard/features/settings/components/settings-layout.tsx`) — every `/$organizationId/settings/*` page already wraps with it, so the downgrade banner is visible even when the user lands on `settings/billing`.
- **Content when `isDowngraded && integrationCount > 0`:**
  > "This workspace is on the Free plan with {n} active integrations. The Free plan doesn't include integrations — deliveries are paused. [View integrations] [Manage billing]"
- **Content when `scheduledDowngrade != null`:**
  > "Your plan will change to Free on {date}. Disconnect integrations you don't need before then to avoid paused deliveries."
- **Implementation:** `useEntitlements()` already gives `plan` + `entitlements`. After extending `WorkspacePlanGet` (§7.3), `usePlan()` (`apps/web/src/dashboard/hooks/use-plan.ts:7`) yields `downgradeState.isDowngraded` reactively; the banner is a simple `if` in the layout. No cookie hint needed — workspace switcher already re-fetches `workspacePlanCollection` per-org.

### 8.2 Dedicated list (actionable)

- **Location:** `/$organizationId/settings/integrations/index.tsx` (`apps/web/src/dashboard/routes/$organizationId/settings/integrations/index.tsx`) — the integrations index already renders per-provider cards (`apps/web/src/dashboard/features/integrations/components/integration-card.tsx`).
- **When downgraded:** render an additional `DowngradeCleanupCard` above the provider grid: table of `integration_connection` rows (`name`, `provider`, `lifecycle`, `createdAt`) with a `Delete` / `Disconnect` action per row. Use the existing per-provider `removeEndpoint` / `disconnect` mutations (`integrations/webhook/src/webhook-management-live.ts:603`, `integrations/slack/src/slack-connection-service.ts:433`, `integrations/discord/src/discord-connection-service.ts:500`, `integrations/github/src/github-management-live.ts:269`). After delete, the `isDowngraded` flag clears itself (derived) on next query.
- **No blocking modal.** Blocking the whole settings tree on a downgrade is punitive and is not precedent — board limits never block profile settings. If a block is desired at all, gate only the `Connect` button (show `Upgrade` instead, as `integration-card.tsx:80-110` already does) and gate outbound delivery creation server-side.

### 8.3 Alternatives considered and rejected

| Surface | Why rejected |
| --- | --- |
| Full-screen blocking modal on every settings page load | Breaks deep links, feels like a dark pattern, has no precedent (email paused never blocks navigation). Also requires client to remember "dismissed" state. |
| Redirect to `/settings/billing` | Loses context for the integrations the user needs to delete. |
| Browser cookie hint `feeblo_downgraded=1` set by server | Tempting for SSR flash prevention, but `workspacePlanCollection` already preloads in `beforeLoad` (`apps/web/src/dashboard/routes/$organizationId/settings/billing.tsx:42-50`) with `staleTime: POSITIVE_INFINITY`. Cookie would add a second source of truth for no gain. |
| Soft-delete with 7-day undo | Adds a retention table, background GC (cf. `docs/r2-temporary-editor-media-lifecycle.json` precedent), and a recovery flow that no downgrade path needs when pause+manual delete works. |

---

## 9. Concrete implementation sketch (file paths only)

```
packages/domain/src/plan-entitlements.ts         — no change (already correct free=false)
packages/domain/src/entitlement/policies.ts      — add mayUseIntegrations(orgId) + getDowngradeState(orgId)
packages/domain/src/workspace/repository.ts      — add countActiveIntegrationsByOrganizationId + findDowngradeState (join plan + counts)
packages/domain/src/workspace/handlers.ts        — enrich WorkspacePlanGet to return downgradeState
packages/domain/src/workspace/schema.ts          — extend WorkspacePlan success schema with optional downgradeState
packages/db/src/schema/integration.ts            — no migration (reuse lifecycle=paused)
integrations/core/src/integration-delivery-postgres-repository.ts — gate createDelivery by mayUseIntegrations (or lifecycle=paused), with paused_by_plan lastError
apps/web/src/dashboard/lib/collections.ts        — no new collection; extend WorkspacePlan type
apps/web/src/dashboard/hooks/use-plan.ts         — expose downgradeState (already threaded)
apps/web/src/dashboard/features/settings/components/settings-layout.tsx — add downgrade banner
apps/web/src/dashboard/routes/$organizationId/settings/integrations/index.tsx — add cleanup list
integrations/slack|discord|github|webhook -management-live — add entitlement check to connect/create (fix gap in §3)
```

Server composition root (`apps/server/src/index.ts`) wires the delivery worker; add `EntitlementPolicy` to the worker's dependency layer if not present.

Testing: extend `packages/domain/src/workspace/handlers.test.ts:368-550` with a case "returns free with downgrade details when integrations remain" akin to the `past_due` tests already there; extend `packages/domain/src/billing/repository.ts` and `packages/domain/src/entitlement/policies.test.ts` pattern for the new gate.

---

## 10. Risks and rollout

- **Webhook lag:** Polar webhook can take seconds to minutes. The existing billing page already polls `workspacePlanCollection.utils.refetch()` for 30s after `checkout_id` (`apps/web/src/dashboard/routes/$organizationId/settings/billing.tsx:96-145`). Reuse that polling after `subscription.active` webhook too — the derived flag will flip the instant the row lands, no manual "mark downgraded" click needed.
- **Noisy banner:** Free workspaces that never had integrations must never see a banner. Guard is `isDowngraded = plan==='free' && integrationCount > 0` — existing free orgs with zero connections see nothing.
- **Upgrade recovery:** When a free org upgrades, `findPlanByOrganizationId` immediately returns `starter|professional`; reconciliation resumes paused deliveries (copy `reconcileEmailOutbox` shape in `packages/domain/src/email-outbox/workflow.ts:1197-1250` and `packages/domain/src/email-subscription/repository.ts:591-650`).
- **Telemetry:** Add `recordIntegrationPausedByPlan` analogous to `recordEmailDeliveryTransition("paused_by_plan")` (`packages/domain/src/email-outbox/repository.ts:487-505`) so pausing is observable.

---

## 11. What would make this recommendation wrong

If the product requirements instead demand **immediate hard enforcement** even during an active `cancel_at_period_end` window (i.e., cancel now = lose integrations now, despite Stripe/Polar still billing until period end), then the derived resolver's semantics would need an override flag. That would contradict Polar's own customer-portal semantics and would need product sign-off. Today the resolver is correct; preserve it.

If the team prefers to block the entire settings area during downgrade, a persisted `downgradeAcknowledged` boolean (user-dismissable) could be warranted — but it must be _acknowledgement_, not _entitlement_, and still sits beside the derived check, not replacing it.

---

## 12. Primary-source index

| Claim | Source |
| --- | --- |
| Subscription schema + status / cancelAtPeriodEnd / currentPeriodEnd / endsAt fields | `packages/db/src/schema/auth.ts:211-300` |
| Product `metadata.plan` JSONB | `packages/db/src/schema/auth.ts:305-360`, `packages/domain/src/billing/repository.ts:140-160` |
| Derived plan resolver (`active`/`trialing` or `past_due` + `currentPeriodEnd > now`, else `free`) | `packages/domain/src/workspace/repository.ts:234-280`, `packages/domain/src/billing/repository.ts:33-37` |
| No downgraded column / no downgrade string in codebase | `grep -rn downgrade packages/` (zero hits) |
| Billing upsert on `external_id`, webhook payload handling | `packages/domain/src/billing/repository.ts:92-188`, `packages/auth/src/server.ts:543-590` |
| Polar webhook types handled | `packages/auth/src/server.ts:562-590` (`product.created`, `subscription.*`) |
| Polar SDK product/subscription payload types | `packages/domain/src/billing/repository.ts:3-4` (`@polar-sh/sdk/models/components/...`) |
| Polar config (`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_MODE`) | `packages/domain/src/billing/config.ts:4-32`, `packages/auth/src/server.ts:544-553` |
| `PLAN_ENTITLEMENTS.free.integrations === false` | `packages/domain/src/plan-entitlements.ts:113-165` |
| Entitlement policy pattern (derived, count-gated, `PolicyDenied`) | `packages/domain/src/entitlement/policies.ts:45-270` |
| Board/roadmap/changelog/CRM entitlement gates (precedent) | `packages/domain/src/board/policies.ts:30-67`, `packages/domain/src/roadmap/policies.ts:29-60`, `packages/domain/src/changelog-category/policies.ts:18-48`, `packages/domain/src/contact/policies.ts:53-92`, `packages/domain/src/membership/policies.ts:83-110` |
| Permissions `integrations.manage` (admin-only) | `packages/permissions/src/permissions.ts:47`, `packages/permissions/src/role-permissions.ts:47` |
| Integration RPCs gate only `integrations.manage`, no entitlement check | `integrations/slack/src/slack-rpc-handlers.ts:11`, `integrations/discord/src/discord-rpc-handlers.ts:11`, `integrations/github/src/github-rpc-handlers.ts:11`, `packages/domain/src/integration/external-resource/handlers.ts:18`, `integrations/webhook/src/webhook-rpc-handlers.ts:10` |
| Integration connection/route/delivery lifecycle & indexes | `packages/db/src/schema/integration.ts:43-240`, `packages/domain-contracts/src/integration.ts:58-110` |
| Integration card `locked` vs `connect` vs `configure` (client-side entitlements gate) | `apps/web/src/dashboard/features/integrations/components/integration-card.tsx:67-110` |
| Board over-limit `Empty` pattern + `atBoardLimit` | `apps/web/src/dashboard/features/board/components/create-board-dialog.tsx:63-130` |
| Plan hook / entitlements hook / live query collection | `apps/web/src/dashboard/hooks/use-plan.ts:7`, `apps/web/src/dashboard/hooks/use-entitlements.ts:8-14`, `apps/web/src/dashboard/lib/collections.ts:workspacePlanCollection` |
| Billing settings + post-checkout polling (30s) | `apps/web/src/dashboard/routes/$organizationId/settings/billing.tsx:96-145`, `apps/web/src/dashboard/features/billing/components/upgrade-dialog.tsx`, `apps/web/src/dashboard/features/billing/lib/checkout.ts` |
| Better-auth org hooks + prior-art subscription revoke on delete | `packages/auth/src/server.ts:235-251`, `packages/auth/src/server.ts:640-660` |
| Email `paused_by_plan` precedent (reversible downgrade) | `packages/domain/src/email-outbox/workflow.ts:108-170`, `packages/domain/src/email-outbox/workflow.ts:1197-1250`, `packages/domain/src/email-outbox/repository.ts:487-537`, `packages/domain/src/email-subscription/repository.ts:580-650` |
| Integration webhook / delivery management (destructive ops) | `integrations/webhook/src/webhook-management-live.ts:603-670`, `integrations/slack/src/slack-connection-service.ts:433`, `integrations/discord/src/discord-connection-service.ts:500`, `integrations/github/src/github-management-live.ts:269` |
| Stripe `cancel_at_period_end` semantics (primary) | `https://docs.stripe.com/api/subscriptions/object#subscription_object-cancel_at_period_end`, `https://docs.stripe.com/billing/subscriptions/cancel` |
| Polar webhook reference (primary) | `https://docs.polar.sh/api-reference/webhooks` (and SDK types in `@polar-sh/sdk`) |
