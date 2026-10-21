# Over-Plan Gate & Remediation Plan

> **Status:** Slices 1–4 implemented on branch `feat/over-plan-gate` on 2026-10-19. `pnpm check`, the domain and web unit tests, and `e2e/tests/over-plan.spec.ts` pass. No migration, no dependency change.

## Objective

A workspace that loses a paid plan keeps the state the paid plan paid for: private boards and roadmaps, and more boards, members, changelog categories, and CRM entries than the new plan allows. Only _creation_ is gated today, so the paid surface survives the downgrade for free. This work names that state, computes it from the plan the workspace is on, and gates its own dashboard until an owner resolves it — without ever publishing or deleting customer data on its own.

## What a downgrade is, and is not

- The plan is derived per read from the Polar subscription (`entitledSubscriptionCondition`), and `CreateBillingPortal` hands the customer to Polar's hosted portal. There is no downgrade event to veto, and blocking cancellation is not an option.
- Several paid capabilities already degrade at read time and are **not** part of this work: integrations pause deliveries (`paused_by_plan`), Public API rejects keys with `PLAN_REQUIRES_UPGRADE`, `hidePoweredBy` is masked to `false`, widget SSO is refused at identify time, subscriber emails are dropped in the outbox queue.
- The leak is **state**. Nothing revokes it, and nothing may: making a private board public publishes its posts and voters, and deleting a board, contact, or company destroys customer content. The owner chooses; the system never chooses for them.
- The public portal, the widget, and the Public API are never gated. They serve the workspace's customers; the gate exists to make the workspace itself pay for its plan, not to break its product.

## Settled decisions

| Decision | Choice |
| --- | --- |
| Posture | A remediation gate on the dashboard; existing capability gates stay read-time |
| Scope | Retention after a downgrade. Trial farming across workspaces is a separate detector and out of scope |
| Who is gated | Everyone in the workspace's dashboard. Actions only for `billing.*` holders; other members see the state and "ask an admin" |
| Grace period | None. A paid subscription is entitled through `currentPeriodEnd`, so the paid period was the notice |
| Pre-downgrade warning | Deferred; it needs a projected plan, which is a different computation |
| Computation | Live on every dashboard entry. No table, no migration, no recorded `over_plan_since` |
| Enforcement | UI/route gate. The existing server policies remain the real boundary; no blanket write guard |
| Fixable violations | Private boards, private roadmaps, boards over limit, members over limit, changelog categories over limit, CRM entries over limit |
| Informational only | Paused integrations, inactive API keys, branding, widget SSO, subscriber emails |
| Excluded | The 3-free-workspaces-per-owner cap (ADR 0013); it is owner-scoped and its only remedy is deleting a workspace |
| Deletion | Inline in the gate, one resource per action, typed confirmation carrying the blast radius, no bulk delete |
| Excess selection | The gate lists the resources; it never preselects which are "the excess" |
| Upgrade path | A link to `/settings/billing`, which already hosts the plan cards and `UpgradePlanDialog` |
| Vocabulary | Over-plan, Remediation, Remediation action, Member, End user (see `CONTEXT.md`) |

## The gate

### Route

`apps/web/src/routes/_dashboard/$organizationId/over-plan.tsx`, a child of the existing `$organizationId` route, so it is inside `AuthGate` and outside both dashboard and settings layouts. It renders full-screen with no sidebar.

`$organizationId.tsx` gains a `beforeLoad` that preloads the compliance snapshot and throws `redirect` to the gate when:

- `violations.length > 0`, and
- the current pathname is not on the allowlist below.

The gate route itself is on the allowlist, so the redirect cannot loop. A compliant workspace never fetches resources, only counts (see below), so the redirect check stays cheap on every navigation.

### Allowlist

The rule is one sentence: **the gate, billing, personal settings, and the pages that explain or fix one of this workspace's findings**. It is derived from the snapshot, not a static list, so a link in the gate always lands on a reachable page.

| Path | When |
| --- | --- |
| `/$organizationId/over-plan` | Always |
| `/$organizationId/settings/billing` | Always |
| `/$organizationId/settings/{profile,notifications,preferences,security}` | Always — personal, never workspace state |
| `/$organizationId/board/*`, `/$organizationId/post/*` | `boards` or `privateBoards` |
| `/$organizationId/contact`, `/$organizationId/company` | `crmEntries` |
| `/$organizationId/settings/changelog-categories` | `changelogCategories` |
| `/$organizationId/settings/integrations*` | `integrations` is degraded |
| `/$organizationId/settings/developers` | `publicApi` is degraded |
| `/$organizationId/settings/customize` | `removeBranding` is degraded |
| `/$organizationId/settings/widget` | `widgetSso` is degraded |

Everything else — the dashboard index, changelogs, roadmap, members, other settings — is replaced by the gate.

### Contents

1. **Header** — "This workspace is over its {plan} plan", the plan's display name, one sentence on why.
2. **Violations**, one section per resource page, ordered by cost:
   - **Boards** — every board, with `Private` and `Over limit` chips; `Make public` on private rows, `Delete` on any row.
   - **Roadmaps** — private roadmaps; `Make public`, `Delete`.
   - **Members** — every member, whatever their role, plus pending invitations; `Remove`, `Cancel invitation`.
   - **Changelog categories** — `Delete`.
   - **CRM entries** — contacts and companies; `Delete`. Each section shows `N of limit` and, when the list is truncated, `showing N of M`.
3. **What else stopped** — a collapsed section listing the degraded capabilities with links, per the allowlist.
4. **Footer** — `Change plan` (link to billing), `Contact support`. No dismiss, no snooze.

### Actions and confirmations

Each row is one action against one resource, calling the existing RPC. No new write RPC and no batch.

| Action | Confirmation | RPC |
| --- | --- | --- |
| Make a board public | "Its N posts and their voters become publicly readable. This cannot be undone once indexed." | `UpdateBoard` with `visibility: "PUBLIC"` |
| Delete a board | Type the board name; "deletes N posts, their comments and votes" | `DeleteBoard` |
| Make a roadmap public | "It becomes visible on the public roadmap." | `UpdateRoadmap` with `visibility: "public"` |
| Delete a roadmap | Plain confirm | `DeleteRoadmap` |
| Demote an admin | "They lose admin access immediately." | `UpdateOrganizationMemberRole` to `manager` |
| Cancel an admin invitation | Plain confirm | `CancelOrganizationInvitation` |
| Delete a changelog category | Type the category name; "removes it from N changelogs" | `DeleteChangelogCategory` |
| Delete a contact | Type the contact's name or email; "posts attributed to this contact lose their author" | `DeleteContact` |
| Delete a company | Type the company name | `DeleteCompany` |

After a successful action: invalidate the compliance snapshot and the affected collection, toast, stay on the gate. When the snapshot comes back empty, navigate to `/$organizationId`.

Rank rules are respected, not bypassed: an admin cannot demote a peer admin (`compareRoles(target, actor) === -1`), so that row renders disabled with "An owner must do this" and the gate stays up. The same applies to the last owner.

## The compliance snapshot

`packages/domain/src/plan-compliance/` — `schema.ts`, `compliance.ts` (the service), `rpcs.ts`, `handlers.ts`. One RPC group, `PlanComplianceRpcs`, registered in `rpc-group.ts` and `rpc-router.ts`. The service reads `PLAN_ENTITLEMENTS[plan]` and the repositories; `plan-entitlements.ts` itself does not change.

### Rules

| Violation | Counts | Trigger |
| --- | --- | --- |
| `privateBoards` | boards with `visibility = PRIVATE` | `capabilities.privateBoards` is false |
| `privateRoadmaps` | roadmaps with `visibility = private` | `capabilities.privateRoadmaps` is false |
| `boards` | all boards | `limits.feedbackBoards !== null && count > limit` |
| `members` | all members **plus** all pending invitations | `limits.members !== null && count > limit` |
| `changelogCategories` | all categories | `limits.changelogCategories !== null && count > limit` |
| `crmEntries` | contacts **plus** companies | `limits.crmEntries !== null && count > limit` |

`degraded` lists the capabilities the plan lacks: `integrations`, `publicApi`, `removeBranding`, `widgetSso`, `subscriberEmails`. It is informational and never triggers the gate.

The gate does **not** trigger on `>=` limit, unlike the create policies: a workspace at exactly the limit is inside its plan and can still create nothing, which is the existing behaviour. "Over" means strictly greater, or a private surface that the plan does not include.

### Shape

```ts
PlanComplianceResource = {
  id: string;
  kind: "board" | "roadmap" | "member" | "invitation"
      | "changelogCategory" | "contact" | "company";
  label: string;                 // board name, member name, contact email…
  detail: string | null;         // "412 posts", "Manager", "Pending invitation · Admin"
};

PlanComplianceViolation = {
  kind: "privateBoards" | "privateRoadmaps" | "boards" | "members"
      | "changelogCategories" | "crmEntries";
  count: number;                 // total, before truncation
  limit: number | null;
  resources: PlanComplianceResource[];  // bounded preview
};

WorkspacePlanCompliance = {
  organizationId: string;
  plan: "free" | "starter" | "professional";
  violations: PlanComplianceViolation[];
  degraded: Array<"integrations" | "publicApi" | "removeBranding" | "widgetSso" | "subscriberEmails">;
};
```

- **Counts first.** The service runs the count queries; it fetches resource rows only for a violation that is already over. A compliant workspace costs a handful of indexed counts and nothing else.
- **Bounded previews.** Boards, roadmaps, and categories cap at 200 rows; CRM entries and members at 100. A row beyond the cap is summarised as "and N more" and the workspace fixes the rest by reloading after the first batch. A professional downgrade with 5,000 contacts upgrades instead of clicking 4,990 times, which is the intended outcome.
- **The same resource can appear twice** (a private board is also a board). The gate merges by `(kind, id)`.
- **Detail counts** that make a confirmation honest (`412 posts`, `3 changelogs`) are computed in the same pass, grouped over the previewed ids.
- **Authorization.** `Policy.hasMembership`. Callers without `billing.*` receive the violations with `resources: []` — kinds and counts are enough to explain the block, and invitation emails must not leak to a contributor. Callers with `billing.*` receive the previews.
- **No new persistence.** Over-plan is a function of `(plan, current state)`; the RPC is the single definition.

### Repository additions

- `BoardRepository.findMany` already filters by `visibility`; add `countByVisibility` if the count query is cheaper than fetching rows (it is).
- `RoadmapRepository` has no `countByOrganizationId`; add counts for all and for `private`.
- `ChangelogCategoryRepository.countByOrganizationId` exists.
- `MembershipRepository.countMembers` and `countPendingInvitations` exist.
- Export `countCrmEntries` from `crm-entry/intake.ts` so the limit and the snapshot share one definition (contacts + companies). The intake transaction keeps its inner call.

## Dashboard wiring

`apps/web/src/dashboard/features/plan-compliance/`:

- `lib/collections.ts` — `planComplianceCollection`, scoped by organization, `queryFn` = `GetWorkspacePlanCompliance`, `staleTime: Infinity` like the plan collection.
- `lib/over-plan-routes.ts` — the allowlist predicate, pure and unit-tested.
- `hooks/use-plan-compliance.ts` — the live query plus `isOverPlan`.
- `components/over-plan-gate.tsx` — the full-screen surface.
- `components/over-plan-banner.tsx` — the strip on allowlisted pages and billing.
- `components/remediation-confirm-dialog.tsx` — typed-confirmation variant of the existing `Dialog`.

Preload happens in `$organizationId.tsx`'s `beforeLoad`, next to the redirect. The gate is the `pendingComponent` while it loads; the dashboard never renders first and is never replaced after the fact, so there is nothing to flash. The collection is invalidated after every remediation action and on the gate route's mount, so an upgrade completed in another tab resolves on the next visit.

The banner: "This workspace is over its {plan} plan — {N} {items} need attention" plus a link to the gate. Members without `billing.*` get "Ask an owner or admin to resolve this workspace's plan" and no link.

## Deferred / out of scope

- Pre-downgrade warning while the paid plan is still active (`cancelAtPeriodEnd`), and the projected-plan computation it needs.
- Trial-farming detection across workspaces.
- A UI for the 3-free-workspaces-per-owner cap (ADR 0013).
- Email or in-app notification when a workspace enters over-plan; the gate is passive.
- Exposing the snapshot on the Public API or MCP.
- A blanket server-side compliance guard; a recorded `over_plan_since`; bulk remediation.
- Presence-filtering the degraded list: it states which capabilities the plan lacks, whether or not the workspace ever used them.

## Implementation slices

1. **Domain snapshot** — `plan-compliance/` module, repository counts, `countCrmEntries` export, RPC registration, tests.
2. **Dashboard routing** — collection, allowlist predicate + tests, `$organizationId` preload and redirect, gate route, banner on allowlisted pages.
3. **Actions** — the nine actions, typed confirmations, invalidation, rank-disabled rows, navigation on resolution.
4. **Polish** — PostHog events (`over_plan_gate_viewed`, `over_plan_remediation_completed`, `over_plan_remediation_action` with `kind`), copy, and the degraded links.

## Verification

- `pnpm check` for each slice.
- `packages/domain/src/plan-compliance/compliance.test.ts` on PGlite, `it.effect` + `layer`: free workspace with each violation kind; starter limits; professional limits; compliant workspace returns no violations and no resource fetches; non-billing caller gets empty `resources`; the `>=` boundary (exactly at limit is not a violation); private board counted in both groups.
- `over-plan-routes.test.ts`: allowlist true/false per path and per snapshot, including the self-exempt gate and personal settings.
- `pnpm db:seed` creates `overplan@feeblo.dev` / `TestPassword123!`: a Free workspace with four boards (one private), three members, four changelog categories, eleven CRM entries, and a private roadmap. Its printed dashboard URL opens on the gate with every fixable finding represented, and its public board URL still serves while the dashboard is gated.
- `e2e/tests/over-plan.spec.ts`: creates a workspace, puts it on Starter through the test-only `/__e2e/set-plan` route (extended to accept `free` so the spec can perform the real downgrade), creates a private board, removes the subscription, and then asserts the redirect, the blocked and allowed pages, the public board staying live, both typed confirmations, and the gate closing after the last finding.
