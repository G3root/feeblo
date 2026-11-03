# 0024 — A ban is workspace-scoped participation, not an account ban

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Public boards and the widget had no way to stop one person from writing. The only remedies were deleting a post after it was public and per-IP rate limits that a determined actor could rotate around. `docs/missing-features-research.md` §3 names the missing posting block list; this records the shape it took.

The two products this feature is measured against treat it differently:

- **Canny** calls it “Ban”. It deletes the person’s profile, votes, and comments, deletes posts with no engagement, keeps posts that other people voted on or commented on (stripping the author’s information), and bans the account from posting again. Marking a post as spam also bans its author.
- **Featurebase** calls it “Ban” or “Block”. It bans by email or user ID from a profile, a request’s menu, or Settings → Users → Blocked, optionally deletes the person’s content, and leaves their existing content visible by default. Banned users can still read public content but cannot interact. Featurebase explicitly does not ban by IP address.

Both are workspace-scoped moderation, not an account-wide login ban. Neither offers end-user-to-end-user blocking.

The product word is **ban**. The feature first shipped in code and copy as “block”, which collides with two nearby meanings that already have their own word here (`user.banned`, `email_suppression`) and with the English verb for the UI primitive. The rename is product terminology, not a schema change: the table, the RPCs, the permission key and the module all say `ban` now, and the migration that creates `user_ban` replaces the unreleased `user_block` one.

## Decision

A **ban** is a workspace-scoped row that stops one end user from participating in that workspace’s self-service surfaces. It is deliberately not two nearby concepts:

- **Not `user.banned`.** That better-auth column is a global login ban. It would stop the person reading every workspace and is the wrong scope; a banned end user must still be able to read the board.
- **Not `email_suppression`.** That table is about deliverability. A ban must not stop account mail, and a suppression must not stop someone posting.

### The row

`user_ban` stores `organization_id`, an optional `user_id`, an optional normalized `email`, an internal `reason`, the member who created it, and timestamps. At least one of `user_id` / `email` is required, and each facet has its own partial unique index. The account facet catches a portal session; the address facet catches a widget SSO contact, a person who has not signed up yet, and an account that changed its address after the ban was written. A ban created from a contact stores both facets, so it survives the contact being deleted. `user_id` is `SET NULL` on account deletion; the copied address is what keeps the ban meaningful.

The email is the secondary key, not a second ban. The repository merges the facets onto one row, so banning an address and later the account it belongs to updates one record.

A ban can name its subject five ways: an account (`user`), a CRM contact (`contact`), an address (`email`), a comment (`comment`), or a post (`post`). The comment and post targets exist for the moderation menus: the server resolves the author from a row it has already scoped to the workspace, so a menu cannot use an account id to read another tenant's user name or address. It also means the person the operator clicked is the person the server bans, without trusting an id the client happened to send — and it makes the participation row itself the proof of relationship, so someone who posted on a public board without a contact row is still bannable there. The raw `user` target keeps the relatedness guard because only the client's word says that account has anything to do with this workspace.

### Enforcement

A `ParticipationPolicy` is composed into the **public half** of the existing surface policies for:

- post create, update, title update, and content update;
- comment create and update;
- upvote toggle;
- post reaction and comment reaction toggles;
- post subscription create.

Deletes stay allowed: a banned person may withdraw their own content. They do not need an unsubscribe permission, because the ban already unsubscribed them. Reads are untouched. A workspace member always passes — membership removal is the correct operation for staff, and banning a member is refused at the RPC (`BadRequestError`) and hidden in the comment menu. The widget checks the resolved SSO contact explicitly; an anonymous widget submission has no identity to check and is therefore not bannable. That is the same limitation Featurebase documents, and the mitigation is the captcha/approval work in the same research section, not an IP ban.

Staff-initiated writes — dashboard on-behalf, the Public API’s key-authenticated writes, and Slack/Discord inbound feedback — are not banned. A ban is about who is acting, not about who a staff member may write about.

### The plan gate

Banning is a paid capability (`userBans` on Starter and Professional, off on Free), enforced by `EntitlementPolicy.canManageUserBans` on the write. The read and the un-ban stay available on every plan: a workspace that downgrades keeps the bans it already has, can still see them, and can lift one. Existing rows keep applying after a downgrade, because a ban that silently stops working when a subscription lapses hands a banned person their voice back.

### Votes and subscriptions

A ban also clears the participation that only makes sense while someone may act:

- every upvote the person cast in that workspace is deleted, so the counts on the posts they boosted drop immediately;
- every post subscription and changelog subscription they hold in the workspace is deleted;
- every email subscription tied to their account or to their address is marked `unsubscribed`.

The email rows are written as `unsubscribed` rather than deleted because `email_subscription` models a consent decision and a re-subscribe has to be verified again; a post or changelog follow carries no history, so it is simply removed.

This runs on every ban with a known account, not only when the operator asks for the content purge. An address-only ban has nobody to strip, which is one more reason the comment and post targets are the preferred way to ban.

### Content

A ban is forward-looking by default. It does not hide or delete existing content, and `publicPostVisibility` is unchanged: a ban must not become a read-time filter that silently removes history.

Deleting the content is the one explicit option, offered as a checkbox on the ban confirmation (settings and the comment menu) and carried as `deleteContent` on `BanUser`. When it is set, the ban and the purge land in one transaction:

- The person's comments in the workspace are deleted. A comment delete cascades to its replies, so a reply by anyone else is first re-anchored to the nearest surviving ancestor — only the banned person's own words are removed.
- The person's posts in the workspace are deleted. A post merged into one of theirs is unmerged first, so no post is left pointing at a row that no longer exists.
- No post-timeline entries are written: a purge is one operator decision and the ban row is its audit record. The purge deletes no engagement as authored content: votes and reactions the person left on other people's posts are not touched here. Deleting their votes is the ban's own work, not the purge's — see [Votes and subscriptions](#votes-and-subscriptions) above.

An address-only ban has no account, so the checkbox is a no-op there.

## Consequences

- The migration adds one table and three indexes; no backfill. Because the `user_block` migration only ever existed on this branch, the rename rewrites that migration in place instead of adding `ALTER TABLE … RENAME`, so the chain has one create and no transitional name. If that migration had already run against a real database, this has to become a rename migration instead.
- `userBans.manage` is granted to manager and above. The portal can ask `GetUserBanStatus` for the caller’s own state and disable its composers without ever seeing the operator’s reason.
- The ban list lives on Settings → Security, next to widget SSO, because both answer “who is allowed to interact here”. The old `settings/blocked-users` route is gone.
- A ban by address can be evaded by changing the address, and an anonymous widget submission can be evaded by clearing the browser. Identity verification and the moderation queue are the answers to those, not an IP block.
- The tests pin the policy directly, pin the purge (the reply re-anchor, the post revert), and pin a banned refusal on each public write that composes the participation check on its own: post create and its three updates, comment update, both reaction toggles, and post subscription. A dropped composition fails a test, not just a review.
