# ADR 0013: A free owner owns at most three free workspaces

## Decision

Workspace creation (`WorkspaceRpcHandlersEffect.WorkspaceCreate`) enforces a per-user cap: a user may own at most `PLAN_ENTITLEMENTS.free.limits.workspaces` (3) workspaces whose plan resolves to `free`. Ownership means the user's member role list contains `owner`; paid workspaces are not counted and do not raise the cap, so upgrading one of the free workspaces frees a slot.

The cap lives in the plan catalog as a `LimitFeatureKey`, next to feedback boards, admin roles, changelog categories, CRM entries, and submission recipients, rather than as a private constant in the workspace module. The check runs inside the create transaction, after `WorkspaceRepository.lockUser` takes a `FOR NO KEY UPDATE` lock on the user row.

## Why

The free plan is per workspace: each free workspace carries its own boards, CRM entries, and other allowances, so without a cap one account multiplies the free tier without limit. `WorkspaceCreate` is the only user-reachable creation path — better-auth's `/organization/create` is disabled with `allowUserToCreateOrganization: false` — so the rule has exactly one place to hold.

The rejected alternatives are the argument. "Any paid workspace lifts the cap" lets one subscription unlock unlimited _free_ workspaces, which is the farming hole the cap exists to close. A hard cap on total workspaces regardless of plan blocks a paying customer from a fourth workspace on a plan they upgraded for. Excluding paid workspaces from the count, and applying the cap only to free ones, keeps both properties: paying never buys less than free, and free capacity never exceeds the free plan's allowance.

The concurrency device is the existing one, one scope up. A per-workspace limit locks the organization row before counting (`lockOrganization`); a per-user limit has no such row to lock, so it locks the `user` row the same way — `FOR NO KEY UPDATE`, taken before the transaction's first child insert, for the same key-share reason. Without the lock, two creates arriving from two tabs can both count two and both insert.

## Consequences

- A user can own unlimited _paid_ workspaces: each upgrade either is the paid workspace or frees a slot. That is pay-per-workspace, and intended.
- The invariant is on free workspaces at each create, not on lifetime total. A create-then-upgrade cycle grows the total owned while never holding four free workspaces at once.
- Workspaces created before this change are not migrated; an owner already over the cap simply cannot create another until a free one is upgraded or deleted.
- The pricing payload (`/api/plans`) gains a `workspaces` key and `PLAN_PRICING_FEATURES.free`/`starter` gain display rows. Professional gets no row: it improves nothing over Starter here, and `PLAN_PRICING_FEATURES` lists only what a plan adds over the one below.
- PGlite is single-connection, so the race the lock prevents cannot be exercised in unit tests. The lock's comment and this record carry the guarantee.
