# ADR 0023: On-behalf provenance survives the subject's deletion

## Decision

`post_activity.metadata.onBehalfOf` records a snapshot of the subject alongside the identifiers: `{ contactId?, userId?, name?, email?, kind }`. `kind` is `member` or `customer`; `name` and `email` are who the subject was at write time. All three are optional, so rows written before this change still decode.

The dashboard renders the live contact or member when it resolves, so a CRM rename still reaches old entries, and falls back to the snapshot when the contact or the member row is gone. A row with neither reads "a customer", or "a workspace member" when `kind` says so.

Two supporting changes make deletion non-destructive in the paths that outlive the metadata:

1. `post.author_name` stores the attributed author's display name at write time. A contact-only author has no `creator_id`, so deleting the contact nulls the only pointer the row had; the column is the fallback that keeps the author visible. It is read only by the dashboard (public selects never join it), the live contact or account still wins over it, and a CRM rename updates it without touching the post's `updated_at`. The migration backfills it for existing contact-anchored posts.
2. `findAdoptableByIdentityHash` orders candidates by class — a verified portal identity bound to the workspace, then a real unrestricted account, then an attribution-only shadow — and matches a global account by its address as well as by hash, because a better-auth-created row carries no `email_hash`. `healShadowsForVerifiedUser` also discovers shadows by email hash. Together these close the hole where deleting a customer and having them sign up later left their posts and votes owned by a shadow they could never sign in to.

## Why

Provenance was stored as identifiers only and resolved against the live contacts and members collections. Deleting a contact, or removing a member, therefore collapsed every affected timeline entry to "on behalf of a customer": the ids still existed in the JSON, but nothing could name them. That is a history bug, not a cosmetic one — the timeline is the audit record of who wrote what for whom.

The delete confirmation claimed "their posts, votes, and comments stay attributed to them". It was true when the subject had an account and false when they did not, which is exactly the post-only case the resolver creates for a bare email (`needsUser: false`). The dialog now branches on the linked account, and the Customers table exposes the same fact so an admin can see it before deleting anything. `post.author_name` exists so the second branch can keep its promise too: a display name outlives the CRM record, while the record's identity does not.

The newer shadow-before-real ordering was a second-order effect of deletion: a shadow whose contact is gone is invisible to the contact-driven heal, and an orphaned shadow outranked a real account in adoption. The ordering fix is scoped to account class, not to a new column, so the existing SSO precedence is preserved: a verified portal identity still beats a global account, because the workspace's identity provider is the proof its own users can present.

## Consequences

`ResolvedPrincipal` gained `name` and `email`, which every caller of `toOnBehalfMetadata` now stores. The vote-removal path, which resolved only a contact id, reads the account, contact, and membership in one query so a member voter is snapshotted as staff rather than relabelled a customer.

The Customers table's `ListContacts` read joins `user` and `member` and classifies each row with `evaluateOrganizationAccess`, the same function the delivery gate uses. A duplicate rule would let the CRM promise delivery the gate would refuse, so the classification is shared rather than reimplemented in the UI. With no post in hand the table cannot decide rule 3, so an unrestricted account reads as `PUBLIC_ONLY` rather than either "notified" or "not".

The snapshot is not a cache of the author's name for display: the live contact still wins, so renames propagate. It is a record of who the entry was written for, used only once live resolution fails.

## Data erasure

The snapshots are retention by design: `onBehalfOf.name` / `onBehalfOf.email` and `post.author_name` are copies of who the subject was, and they stay in historical rows after the contact or the account is gone. Deleting a customer is a CRM operation, not a data-erasure request — the attribution record deliberately outlives the CRM row. An erasure request is a different operation and needs its own path that finds and blanks these snapshots; this ADR records the gap so the retention is not mistaken for an oversight.
