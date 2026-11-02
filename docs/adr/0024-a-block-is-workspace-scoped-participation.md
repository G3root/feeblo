# 0024 — A block is workspace-scoped participation, not an account ban

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Public boards and the widget had no way to stop one person from writing. The only remedies were deleting a post after it was public and per-IP rate limits that a determined actor could rotate around. `docs/missing-features-research.md` §3 names the missing posting block list; this records the shape it took.

The two products this feature is measured against treat it differently:

- **Canny** calls it “Ban”. It deletes the person’s profile, votes, and comments, deletes posts with no engagement, keeps posts that other people voted on or commented on (stripping the author’s information), and bans the account from posting again. Marking a post as spam also bans its author.
- **Featurebase** calls it “Ban” or “Block”. It bans by email or user ID from a profile, a request’s menu, or Settings → Users → Blocked, optionally deletes the person’s content, and leaves their existing content visible by default. Banned users can still read public content but cannot interact. Featurebase explicitly does not ban by IP address.

Both are workspace-scoped moderation, not an account-wide login ban. Neither offers end-user-to-end-user blocking.

## Decision

A **block** is a workspace-scoped row that stops one end user from participating in that workspace’s self-service surfaces. It is deliberately not two nearby concepts:

- **Not `user.banned`.** That better-auth column is a global login ban. It would stop the person reading every workspace and is the wrong scope; a blocked end user must still be able to read the board.
- **Not `email_suppression`.** That table is about deliverability. A block must not stop account mail, and a suppression must not stop someone posting.

### The row

`user_block` stores `organization_id`, an optional `user_id`, an optional normalized `email`, an internal `reason`, the member who created it, and timestamps. At least one of `user_id` / `email` is required, and each facet has its own partial unique index. The account facet catches a portal session; the address facet catches a widget SSO contact, a person who has not signed up yet, and an account that changed its address after the block was written. A block created from a contact stores both facets, so it survives the contact being deleted. `user_id` is `SET NULL` on account deletion; the copied address is what keeps the block meaningful.

The email is the secondary key, not a second block. The repository merges the facets onto one row, so blocking an address and later the account it belongs to updates one record.

### Enforcement

A `ParticipationPolicy` is composed into the **public half** of the existing surface policies for:

- post create, update, title update, and content update;
- comment create and update;
- upvote toggle;
- post reaction and comment reaction toggles;
- post subscription create.

Deletes and unsubscribes stay allowed: a blocked person may withdraw their own content and leave the mailing list. Reads are untouched. A workspace member always passes — membership removal is the correct operation for staff, and blocking a member is refused at the RPC. The widget checks the resolved SSO contact explicitly; an anonymous widget submission has no identity to check and is therefore not blockable. That is the same limitation Featurebase documents, and the mitigation is the captcha/approval work in the same research section, not an IP ban.

Staff-initiated writes — dashboard on-behalf, the Public API’s key-authenticated writes, and Slack/Discord inbound feedback — are not blocked. A block is about who is acting, not about who a staff member may write about.

### Content

A block is forward-looking. It does not hide or delete existing content, and `publicPostVisibility` is unchanged: a block must not become a read-time filter that silently removes history. Deleting a blocked person’s posts or comments is a separate, explicit action using the existing delete paths.

## Consequences

- The migration adds one table and three indexes; no backfill.
- `userBlocks.manage` is granted to manager and above. The portal can ask `GetUserBlockStatus` for the caller’s own state and disable its composers without ever seeing the operator’s reason.
- A block by address can be evaded by changing the address, and an anonymous widget submission can be evaded by clearing the browser. Identity verification and the moderation queue are the answers to those, not an IP block.
- The tests pin the policy directly and pin one public write (a comment) as the end-to-end refusal; the remaining public writes are covered by the same policy composition and the compile-time surface pairing.
