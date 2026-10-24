# On-behalf attribution

Workspace members can create posts, add voters, and publish comments that are attributed to a customer instead of to themselves — typically feedback that arrived on another channel (email, call, ticket). This page is the canonical reference for how attribution, access, and notification delivery work. A reader should be able to answer "who gets notified, and why?" from this page alone.

## Vocabulary

- **Actor** (principal): the authenticated staff member performing an action. Always recorded for audit (`post_activity.actorId` / `actorMemberId`).
- **Subject**: the person an action is attributed to. A customer subject resolves to a **contact** — the workspace-scoped customer record (`contact` table, unique `(organization_id, email)` and `(organization_id, external_id)`). A staff subject resolves to their **member row**; staff are never contacts and never consume a CRM entry (see ADR 0017).
- **Shadow user**: an attribution-only account (`user` row with a synthetic `behalf-*@feeblo.com` address, `emailVerified = false`, `restrictedToOrganizationId` set). Shadow users have no credentials, can never authenticate, and exist only so votes and comments — which require a `user_id` — can be attributed to customers who never signed up. Their display name tracks the customer record: comments, votes, and the voter list render the account's name, so a rename in the CRM renames the account too (a real account owns its own name and is left alone). Deleting the customer deletes the shadow account too when nothing refers to it any more; attributed content keeps it alive, and a later attribution of the same email adopts it again. A shadow that outlives its contact is still healed into the real account when the human signs up, because discovery also runs by email hash (ADR 0023).
- **SSO portal user**: a real customer account created through widget SSO (`sso-*@feeblo.com`, `emailVerified = true`, org-restricted). Distinct from a shadow user: their identity was proven by the customer's identity provider.
- **Deferred subscription**: an `email_subscription` in state `deferred_no_access`. Created for subjects without verified accounts; never emailed until the subject gains organization access (see below).

## Resolution

Every on-behalf action resolves its subject through `ResolvePrincipalService` (`packages/domain/src/identity/`). Identifiers are consulted in strict priority order:

```text
userId  >  contactId  >  externalId  >  email (+ name/avatar enrichment)
```

"No match" is not an error — the resolver find-or-creates. Rules:

| Input resolves to | Behavior |
| --- | --- |
| Existing contact | Used as-is; enriched only on empty fields. If the action needs a user row and none is linked, a shadow user is provisioned. |
| Email matches a global user with no contact here | Contact created and linked to that real account — never shadowed. |
| Email matches an account restricted to another organization | Invisible; a fresh org-scoped contact (and shadow, if needed) is created instead. |
| Email matches this org's SSO portal user | Adopted — same human, proven identity. |
| Account is a workspace member | Resolved to the account and its member row. No contact is created, and the plan's CRM-entry allowance is not spent (ADR 0017). An existing contact for that account still wins. |
| Account is a member of another organization | A customer here: contact (and shadow, if needed) created in this workspace. |
| No match anywhere | New contact, plus a shadow user when required. |

Subject fields never overwrite known contact data; they backfill empty name/avatar only. Inserts tolerate unique-index races by re-reading the winner.

## Permissions

Named permissions follow the two-layer model in `docs/permissions.md`:

| Permission | Minimum role | RPCs |
| --- | --- | --- |
| `posts.createOnBehalf` | manager | `CreatePost` with `author`, `UpdatePostAuthor` |
| `comments.createOnBehalf` | manager | `CreateComment` with `author` |
| `votes.onBehalf` | contributor | `AddUpvoteOnBehalf`, `RemoveUpvoteOnBehalf` |

Absent `author` objects mean "the session user" — every pre-existing code path is unchanged. Public-board RPC variants reject `author`.

Voter management is deliberately **not** a toggle: `AddUpvoteOnBehalf` is idempotent (a repeat add succeeds without a duplicate) and `RemoveUpvoteOnBehalf` deletes exactly one subject's vote, so an admin can never remove someone else's vote by accident.

## Provenance

`post.source` stays `DASHBOARD`; on-behalf facts live in `post_activity.metadata` as `{ onBehalfOf: { contactId?, userId?, name?, email?, kind } }` with the admin recorded as the actor. The last three fields are a snapshot taken at write time — `kind` says `member` or `customer`, `name` and `email` are the subject's identity then — so the timeline still names the person after the contact or account is deleted. The dashboard renders the live contact or member when it still resolves, so a CRM rename reaches old entries, and falls back to the snapshot when it does not. Rows written before the snapshot fields existed carry only the identifiers and render as "a customer". A customer subject carries `contactId` and usually a `userId`; a staff subject carries `userId` only, which the timeline resolves against the member list (ADR 0017). Activity kinds `VOTE_ADDED` / `VOTE_REMOVED` record voter management and `AUTHOR_CHANGED` records dashboard author reassignment (`UpdatePostAuthor`), which reuses the creation-time resolution rules and subscribes the new author as `post_creator`. Dashboard post rows display contact-only authors (no linked user row) under their contact name; public rows never fall back, so customer names stay off public boards. Timelines render "created by Sarah on behalf of john@acme.com", and a staff subject renders as "on behalf of Bob (workspace member)".

## Deleting a customer

`DeleteContact` removes the CRM record. What happens to attributed content depends on whether the person had an account:

| Subject had | Post author | Votes and comments | Timeline |
| --- | --- | --- | --- |
| A shadow or real account | Kept: `post.creator_id` still names the account | Kept: they hang off the account, and the shadow is not deleted while they exist | Kept, from the snapshot |
| No account (post-only attribution) | Kept as a name: `post.author_name` still names them after `post.contact_id` is nulled; the link to the CRM record is gone | None exist | Kept, from the snapshot |

The confirmation dialog states which of the two applies before the write. `post.author_name` is a dashboard-only display snapshot: the live contact or account always wins, so a rename shows through, and the column is only read once both are gone. It is never selected on a public surface. A shadow left without a contact is healed into the real account the next time that human proves the address (signup or verification), because shadow discovery runs by email hash as well as by contact. The Customers table shows the linked account's class (`Workspace member`, `Portal account`, `Account`, `On-behalf only`, `No account`) and whether the delivery gate can reach them — `Notified on public boards only` for an unrestricted account, `Won't be notified` for an unverified one, a shadow, or no account. The snapshots are attribution records, not an erasure story: deleting a contact leaves their name and email in historical activity rows and in `post.author_name`; an erasure request needs its own pass over them (ADR 0023, "Data erasure").

## Notifications

In-app notifications are unchanged: recipients are workspace members only.

Email follows attribution. Post creators are auto-subscribed (`post_creator` source); a voter added on behalf is explicitly subscribed (`admin_added_voter` source); self-service voting and commenting subscribe nobody. Reassigning a post's author retires only the previous author's `post_creator` subscription: an `explicit` opt-in or an `admin_added_voter` row is the recipient's own standing follow and survives the change. A workspace can withdraw consent for one customer from the Customers table (`UnsubscribeContact`, `contacts.update`): every subscription the address holds moves to `unsubscribed`, and the contact row stays.

**Eligibility rule** — before any post-update email materializes, the recipient must pass the organization-access check, re-evaluated per delivery attempt beside plan/consent/suppression:

> The recipient's account is email-verified **and** any of:
>
> 1. they have a `member` row in the workspace,
> 2. their account is bound to the workspace through SSO (`restrictedToOrganizationId` equals the organization), or
> 3. they are an unrestricted global user and the post's board is `PUBLIC`.

Consequences:

- A bare email typed into an author/voter field grants **attribution, never notification**. Its subscription sits at `deferred_no_access` and receives nothing — including verification requests — until the human gains real access.
- Gaining access later (signup, email verification, SSO login) resumes subsequent deliveries automatically. There is no backfill and no manual step.
- Verified double-opt-in external subscribers without any account keep their consent-based delivery; the gate restricts account-holding recipients only, and changelog broadcasts are out of scope entirely.
- Skips are terminal and observable: delivery state `no_organization_access` plus the `feeblo_email_delivery_access_skips_total` metric labeled by recipient class (`member` / `sso` / `global` / `shadow`).

## Identity linking

When the human behind a shadow user shows up with a real account, attributed data heals automatically (`packages/domain/src/identity/linking.ts`):

- Triggers: signup/email verification matching a contact's email, and SSO session creation for the same (email hash, organization).
- Signup/email-verification linking runs one transaction that reassigns contacts, posts, votes, comments, and subscriptions off the shadow user to the real account; collisions with the real user's existing votes/subscriptions drop the shadow's duplicate; the shadow user is deleted last.
- SSO session creation instead promotes the shadow row in place (`upsertSsoUser`): when a `behalf-*` shadow matches by (email hash, organization), the same row becomes the portal identity — fresh synthetic `sso-*` address, `emailVerified = true` — rather than being reassigned and deleted.
- Deferred subscriptions activate when the surviving account satisfies the eligibility rule.
- Contacts with no shadow to heal are covered too: signup and email verification activate the deferred rows of every contact whose address the account proved (`activateDeferredSubscriptionsForVerifiedUser`), and an SSO sign-in activates the rows of the contacts linked to that portal account. Without this, a customer attributed by post author alone would keep a `deferred_no_access` row the outbox never materialises.

Split identities therefore cannot persist: the first time the customer signs up with the email an admin typed, all their attributed history moves to the real account.

## Picker search

`SearchContacts` backs the author/voter/commenter comboboxes: org-scoped, two indexed queries (contacts over trigram indexes + members via `member⨝user`) merged in TS and ranked exact email → email prefix → name prefix → substring, returning `isMember`, `hasAccess`, and `alreadyVoted` badges so the UI can hint "will/won't be notified" before submitting. Author pickers (`AuthorPicker`: post-create `Post author`, dashboard `Change author`) ignore voting state — `alreadyVoted` neither disables rows nor shows a badge there, so a voter can always be reattributed as the author. Only the voter picker disables `alreadyVoted` rows. Member rows carry `contactId: null` — members are staff, never contacts; submit paths resolve via `userId`, and resolution keeps it that way (ADR 0017). A contact row already linked to a member is hidden in favor of the member row. Without post context the board is unknown, so `hasAccess` for an unrestricted verified global user is provisional — eligibility cannot be determined until the post's board visibility is known (callers with a post pass `postId`). An empty result is the create-new-customer entry point (the picker also asks `CheckContactCreateEligibility` before it offers that row, so a workspace at its CRM cap sees the plan limit instead of a failed submit; the write path still enforces the cap in its own transaction). The RPC enforces a per-member dashboard read rate limit (300/minute) alongside the two-character minimum; on-behalf writes (posts, voter add/remove, comments) share a per-member 60/minute bound.

## Where things live

| Concern             | Path                                           |
| ------------------- | ---------------------------------------------- |
| Resolver            | `packages/domain/src/identity/service.ts`      |
| Linking             | `packages/domain/src/identity/linking.ts`      |
| Access evaluation   | `packages/domain/src/email-outbox/access.ts`   |
| Delivery gate       | `packages/domain/src/email-outbox/workflow.ts` |
| Shadow provisioning | `packages/domain/src/user/repository.ts`       |
| Plan and decisions  | `plan-on-behalf.md` (repo root)                |
