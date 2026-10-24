# ADR 0017: A staff subject resolves to a member row, not a contact

## Decision

An on-behalf action whose subject is a member of the acting workspace resolves to that account and its `member` row. The resolver creates no `contact` for it, and the write spends no CRM-entry allowance. A contact that already exists for that account still wins: it stays the attribution anchor, and nothing is deleted.

`ResolvedPrincipal.contactId` is therefore nullable. A customer subject always carries one; a staff subject never does. The on-behalf metadata records what the subject has: `{ onBehalfOf: { contactId?, userId? } }` (later extended with a `name` / `email` / `kind` snapshot; see ADR 0023). Posts and comments written for a staff subject keep the member row (`post.creatorMemberId`, `comment.memberId`), so the member tick survives.

The check runs only when no contact exists for the account, so a human who was a customer before joining the workspace keeps the single customer record their history already points at.

## Why

The resolver's original contract was "every on-behalf action resolves a subject to a contact". That made a teammate a customer: attributing a post to a workspace member inserted a `contact` row linked to their account. The row counted against the plan's `crmEntries` limit, which is ten on the free plan, and it appeared in the Customers table as if a person outside the workspace had asked for something. The picker already treats members as staff — its member leg returns `contactId: null`, and it hides any contact already linked to a member — so the same human was deliberately absent from the customer list inside the picker and present in it everywhere else.

Three shapes were available:

1. **Keep creating the contact and hide it from the customer list.** Rejected. The row still consumes plan room, and hiding a quota-consuming row makes the limit unexplainable.
2. **Create the contact but count only customer contacts against the plan.** Rejected. It is a limit change, not a resolution change, and it would let one workspace grow its contact table for free through attribution.
3. **Resolve staff to their member row and mint nothing.** What shipped. Staff are not customers, the row is not created, and the limit keeps counting the rows that exist.

The plan's own promise is the tie-breaker. `docs/on-behalf.md` already said members are staff and never contacts, and the original plan promised staff attribution would be badged. Option 3 is the shape that makes the sentence true.

## Consequences

A staff subject's attribution is no longer visible in the CRM, so nothing else has to be filtered. The timeline resolves the subject name from the member collection when the metadata carries only a `userId`, and marks it "workspace member" so a staff attribution is distinguishable from a customer one.

The resolver now reads the `member` table on the resolution path. The lookup runs only when the subject is an existing account with no contact in this workspace, which is the same condition that used to trigger the insert, so no ordinary customer resolution pays for it. The write reads are unchanged: they already looked the member row up themselves for self-authored content.

A staff subject with no verified email address can still be attributed to, but receives no post email. Its deferred subscription has no contact to key against, so the subscription is skipped; the delivery gate would refuse an unverified account anyway. The member keeps in-app notifications through their `post_subscription` row.

Member contacts created before this change are left in place. They are ordinary rows that a legal owner can edit or delete through the Customers table; removing them automatically would delete CRM data on a migration's say-so.
