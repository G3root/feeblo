# ADR 0019: Over-plan is a state, not a downgrade event

## Decision

A workspace's plan stays derived at read time from its Polar subscription, exactly as `findPlanByOrganizationId` resolves it today. There is no downgrade event to veto, no stored plan, and no automatic remediation when entitlement lapses.

A workspace whose current plan does not cover the state it already holds is **over-plan**. That state is computed live from the plan and the workspace's own rows, surfaced by a `GetWorkspacePlanCompliance` RPC, and it gates the workspace's dashboard until an owner resolves it. The gate offers explicit, owner-confirmed remediation actions — make a board or roadmap public, demote an admin role, cancel an admin invitation, delete a resource — and never performs any of them on its own. Upgrading is the other exit.

The gate is a dashboard contract, not a security boundary. It adds no blanket server guard; the existing create-time policies (`canCreateBoard`, `canAssignPrivilegedRole`, `canUpdateBoardVisibility`, `canUseIntegrations`, …) remain the enforcement that matters. The public portal, the widget, and the Public API are never gated.

## Why

The rejected alternatives are the argument. **Blocking the downgrade** is unavailable: cancellation happens in Polar's hosted portal, and the plan is a projection of subscription status rather than a field we own. **Auto-compaction** — making private boards public, demoting admins, deleting excess rows — is the only option that fully removes the freebie, and it is the one option that cannot be taken: publishing a customer's private board and deleting their content without consent is worse than the freebie. **Advisory only** leaves the paid surface free for anyone willing to ignore a banner.

Computing live rather than recording a snapshot removes the failure mode that matters most: a stored over-plan row that outlives the condition it recorded and locks a workspace that is no longer over plan. The cost is a handful of indexed counts per dashboard entry, which is cheap because a compliant workspace fetches no resource rows at all.

The deliberate residue: a private board stays private while the workspace is gated, so the paid benefit technically survives until the owner acts. The alternative would leak data. The gate makes ignoring it cost the workspace its own dashboard, not its customers' experience.

## Consequences

- Six counts and, only when over, bounded resource previews are part of the dashboard's route preload. The snapshot becomes the single definition of "over-plan"; a create policy and the snapshot must not drift on what a limit counts.
- Trial farming — creating workspaces to re-enter a trial — is not addressed. It is a per-user history problem with no dialog-shaped remedy, and it stays a separate detector.
- The 3-free-workspaces-per-owner cap (ADR 0013) is excluded: it is owner-scoped, not workspace-scoped, and its only remedy is deleting a whole workspace.
- Deleting a resource to get back inside a limit is possible only from the gate, one row and one typed confirmation at a time. There is no bulk remediation; a workspace with a large overage is meant to upgrade.
- The snapshot's DTO is dashboard-internal. It is not the Public API vocabulary and carries no stability promise.
