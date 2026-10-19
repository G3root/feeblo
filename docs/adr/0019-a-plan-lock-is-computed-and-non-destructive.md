# ADR 0019: A plan lock is computed and non-destructive

## Decision

When a workspace's plan resolves to `free` while it holds more resources than the free plan allows, the over-limit resources become read-only. The gate is a **computed state**, never a stored flag:

- `packages/domain/src/entitlement/lock.ts` is pure keeper math over `(resource, createdAt)` lists. On free, a feature keeps the owner's selected resources first (in stable resource order, capped at the limit), then the oldest unselected ones until the limit is full. Every other resource is locked.
- `packages/domain/src/entitlement/repository.ts` gathers the resources each limit feature counts and persists the owner's **keeper selection** in `plan_lock_selection`. Absence of a row means the deterministic default, oldest first with `id` as the tiebreaker.
- `EntitlementPolicy` exposes `getPlanLock` (the current plan), `getPlanLockPreview` (the same state evaluated on `free`, for the downgrade wizard), and `setPlanLockSelection`.

Locked is **read-only, not deleted**: a locked resource stays visible in the dashboard, exportable, and deletable, and comes back on re-subscribe. Never auto-deleted, at any limit, on any cycle.

The lock applies to the five `LimitFeatureKey` features (feedback boards, privileged members, changelog categories, CRM entries, workspaces) and to the paid capabilities, which wind down per feature (deliveries pause, branding returns, subscriber sends stop). Webhook endpoints stay ungated on every plan. It is a **free-plan rule**: paid plans gate new creation through the entitlement policies but never retroactively lock existing resources, so the pure math treats a paid evaluation as display-only.

`privilegedMembers` holds the owner aside: an owner is privileged but not demotable, so its keeper limit is the plan limit minus the owner count, and owner member rows are never selection candidates.

## Why

The plan already resolves to `free` by computation (`WorkspaceRepository.findPlanByOrganizationId`), with no downgrade event to hook: cancel-at-period-end entries stay entitled until `currentPeriodEnd`, after which the resolved plan simply changes. Storing a "locked" flag would duplicate that resolution and could disagree with it; a computed lock cannot drift.

Deletion was rejected outright. Locking is the anti-abuse property; deleting the excess is data loss with no undo, and the difference between "you can see and export it" and "it is gone" is the difference between a gate and an incident. Read-only with export (the existing data-transfer surface) is what makes the lock actionable for the owner.

The keeper selection is the only persisted piece because it is the only part that cannot be computed: "which two of your five boards matter" is knowledge only the owner has. One `(subject, feature, resource_id)` table covers every limit feature; organization-scoped features select against the workspace, the owner-scoped `workspaces` feature selects against the user, matching ADR 0013's per-owner cap.

The database handle is read per call in `entitlement/repository.ts` rather than captured in a layered service. Bundling a new service into `EntitlementPolicy.layer` would add `Database` to that layer's requirements and change every existing composition; the methods that actually read the database are the honest place for the requirement.

The cost of that choice is worth recording: the `Database` requirement lands on the _policy method signatures_, so `BoardPolicy.canUpdate`, `PostPolicy.isUnlocked` and `UpvotePolicy.canToggle` all carry it, and a composition of one of those policies needs a database in its context whether or not it reads one. A policy that is an authorization check quietly acquiring a database requirement is a surprise; it is the price of not touching twenty-odd compositions, and it is paid knowingly rather than by accident.

## Consequences

- Adding a `LimitFeatureKey` fails to compile until `computePlanLockState`'s caller supplies that feature's resource list: the feature record is total on purpose.
- The workspace-level lock is enforced per feature: the plan lock's assertions are composed into the mutation policies of boards, posts, comments, reactions, votes, post subscriptions, tags, roadmaps, changelogs, changelog categories, CRM entries, attribute definitions, site settings, membership invites and promotions, API keys, and data import. Deletes and exports stay open, and role demotions stay open, so an over-cap owner can resolve the lock. Public reads go dark through the same `listLockedBoardIds` filter the board-slot lock uses.
- Not yet covered by the workspace lock: outbound integration deliveries of a locked workspace still flow (the delivery worker's plan gate covers only the free-plan capability pause for Slack, Discord, and GitHub), and the mutation surfaces without a `*Policy` module (post statuses, roadmap columns, organization settings, JWT secrets, webhook management) still check their permission inline. Both are follow-ups, not silently assumed.
- Selection rows are harmless on a paid plan and are kept across upgrades: the resolver only reads them while the plan is free and the count is over the limit.
- The selection table cascades with the organization and the user, so account erasure (ADR 0011) and workspace deletion take their selections with them.
- Locked boards are treated as not found on public surfaces. They must never be flipped to public to satisfy the board count, and a private board must never be auto-published: both would trade abuse prevention for a privacy incident.
