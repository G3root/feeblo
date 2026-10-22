# 0022 — A suppression list belongs to the sender, except when it belongs to the address

- **Status:** accepted
- **Date:** 2026-10-22
- **Supersedes:** the single global `email_suppression` table introduced with the email outbox

## Context

The outbox shipped with one suppression table keyed by `email` alone. Every bounce and complaint wrote a row, and the send path skipped an address that had one. That is correct for one sender and wrong for a multi-tenant product:

- A complaint is about **one workspace's mail**. Under the old table, a recipient who pressed "spam" on one workspace's changelog stopped receiving that workspace's notifications _and every other workspace's_ — including mail about their own account in a workspace they administer.
- The row had no tenant, so it could not be listed, audited, or removed by the workspace whose mail caused it. Support could only answer with SQL.
- Account-level deletion cascaded `email_contact` and `email_outbox`; the suppression rows survived with a raw address and no owner.

The audit that preceded this decision is in [`docs/audit-email-suppression.md`](../audit-email-suppression.md).

## Decision

`email_suppression` rows are scoped:

| `organization_id` | meaning | matches |
| --- | --- | --- |
| a workspace id | the workspace that observed the event, or a manual block by its admin | that workspace's mail, plus platform mail |
| `null` | a platform row: the event concerned mail that belongs to no workspace (verification, password reset, onboarding) | platform mail; also every workspace's mail, because a hard bounce is an address fact |

The send path reads a workspace row and platform rows; a workspace never reads another workspace's row. Two partial unique indexes keep the scopes separate:

- `email` unique where `organization_id is null`
- `(organization_id, email)` unique where `organization_id is not null`

### What each reason may do

- **`hard_bounce`** is an address fact. It is written for the workspace that observed it, so the fact is attributable, and platform rows apply to every sender. It may be written without a correlated delivery when the provider names the failed recipient.
- **`complaint`** is a sender fact. It is always workspace-scoped and is never written for an uncorrelated event: without a delivery there is no sender to scope it to, and a platform complaint row would silence every tenant because one unknown sender's recipient pressed "spam".
- **`administrative_block`** is workspace-scoped by definition. It is the only reason a human may write.

`reason` never weakens: complaint outranks manual block, which outranks hard bounce. `first_reason` keeps the cause that created the row, so "why was this address suppressed" stays answerable after a stronger event arrives.

### Account mail

Authentication mail has no workspace. It is checked against platform rows only, and a hard bounce observed for it writes a platform row. A workspace's complaint therefore never blocks a password reset; a bounced address is not retried by the auth path.

## Consequences

- The dashboard can list, count, add, and remove suppressions per workspace (`emailSuppressions.manage`, admin and owner). Platform rows are invisible to tenants and are an operator concern.
- A workspace can lift its own complaint or manual block. Lifting one does not lift another workspace's, which is the multi-tenant-correct outcome: the address may still be suppressed for the sender that observed the problem.
- Deleting a workspace cascades its rows. Platform rows have no tenant and are retained as the abuse-prevention record; the retention is documented in the audit, and the erasure path must not remove a platform row that another workspace's reputation depends on.
- The old rows become platform rows in the migration. That preserves the previous behaviour exactly (they matched every sender) and keeps the change reversible in meaning, if not in schema.
- A hard bounce observed by workspace A suppresses A's mail to that address. Workspace B is not silenced by A's row, because B cannot see it; B discovers the same fact the next time it sends and records its own row. The one exception is a platform row, written when the bounced mail belonged to no workspace (account mail) or could not be attributed to one; those apply to every sender. This is a deliberate privacy trade: each sender owns its evidence instead of silently inheriting another tenant's address list.
