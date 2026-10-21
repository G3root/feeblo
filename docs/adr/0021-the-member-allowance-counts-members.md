# ADR 0021: The plan's member allowance counts members, not admin roles

## Decision

`PLAN_ENTITLEMENTS[*].limits.members` bounds the number of **members** a workspace may have. A member is any row in the member table for that workspace, whatever its role, and the owner is one of them. A pending invitation holds a seat before anyone accepts it, so the count is `members + pending invitations`.

The limit is no longer `privilegedMembers`, and no role is privileged for the purposes of the plan. `owner` and `admin` still grant `workspace.update` and still gate the dashboard; `isPrivilegedRole` keeps that job. It no longer has anything to do with billing.

Role changes are therefore not gated at all. Promoting a member to `admin` or demoting one to `contributor` moves nobody in or out of the workspace, so the allowance is unaffected and `UpdateOrganizationMemberRole` no longer opens a transaction or takes a lock.

## Why

The admin-role allowance measured the wrong thing. A workspace could hold fifty managers and contributors on Free and pay for none of them, because the only gated unit was the two `owner`/`admin` rows. The paid surface was the number of people who could _manage_ the workspace, not the number of people who could _use_ it, and the free tier gave away the second one entirely.

Counting members makes the plan's unit match what a customer is buying: seats. It also removes the incentive the old rule created, which was to make everyone a `manager` and keep one admin.

The two neighbouring products this catalog is priced against both work this way, and neither measures a subset:

- UserJot lists "Team members 3 / Unlimited / Unlimited" and "3 admin roles / — / Unlimited" as separate rows, and its help centre defines Owner and Admin as "privileged team members" and Member as the ordinary tier.
- Canny's paid unit is admin seats; voters and submitters are unlimited.

The distinction that survives is the one that matters to the product: **end users are not members**. A person who posts, votes, or comments on the public board or through the widget is not a row in the member table and is unlimited on every plan (`unlimitedEndUsers`). The gate exists to charge the workspace for its own team, never to charge it for its customers.

## Consequences

- **`demote_admin` stops being a remediation.** Demoting no longer reduces any count, so the over-plan gate's row action is `remove_member` (`RemoveOrganizationMember`) and `cancel_invitation` for a pending invite. The violation kind is `members`, the section title is "Members", and each row carries the member's role as its badge.
- **An owner row has no action.** Owners cannot be removed through team settings, and the last-owner rule forbids it outright, so the gate shows the row and offers nothing. This is the same shape the admin-role section had for owners.
- **The `members` limit value is unchanged: 2 / 5 / unlimited.** The unit changed, not the catalogue. A Free workspace with the owner and one teammate is full; a downgrade that leaves three members is over-plan and the gate asks for one to be removed or the plan to be upgraded. If the intended Free tier is "a team of three", the number is a one-line change in `PLAN_ENTITLEMENTS`.
- **The member allowance is a soft gate.** The invite path counts, then better-auth inserts; the two are not in one transaction, so two simultaneous invites can overshoot by one. Nothing locks the count: the invitation insert happens outside our transaction, so a lock taken in the hook would be released before the write it was meant to serialize. The over-plan gate is the backstop, read live on every dashboard entry, which is the posture `docs/adr/0019` already sets for the other limits. `WorkspaceRepository.lockOrganization` lost its last caller to this change and was removed; the per-workspace limits that do lock (`post-status`, `roadmap`, `email-outbox`, `crm-entry`) keep using `lockOrganizationRow`.
- **The pricing DTO key changed, and the decoder is tolerant of that.** `/api/plans` returns `limits.members` instead of `limits.privilegedMembers`. The endpoint is HTTP-cached for an hour and decoded strictly by the web client, so `PlanLimits` declares both keys on the wire and derives `members` from the legacy one only when a cached body carries no `members`; the encoded response never includes `privilegedMembers`. A client outside this repo reading the old name still breaks.
- **A member removal is offered only to a rank that can perform it.** `RemoveOrganizationMember` requires a target ranked strictly below the caller, so the gate filters the `remove_member` action by the caller's role and tells an admin that only an owner can remove another admin. Invitation cancellation is not rank-gated and is offered as before.
