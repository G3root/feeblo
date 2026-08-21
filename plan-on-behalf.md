# On-Behalf Posts, Votes & Comments Plan

> **Status:** Slices 1–8 and 10 are implemented on branch `behalf-user`
> (commits `78bdc151`…`1cd09bbf`); slice 9 (dashboard UI) is pending. The
> canonical feature reference is now `docs/on-behalf.md`; this document
> records the design decisions and, in "As-built deviations" at the bottom,
> where implementation deliberately diverged.

## Objective

Let workspace members create posts, add voters, and publish comments that are
attributed to a customer instead of to themselves. The typical use is feedback
that arrived on another channel (email, call, ticket): the member records it on
the board, names the customer as the author, and later adds other requesters as
voters so they are notified when the post moves.

Two invariants drive every decision below:

1. **Attribution is decoupled from authentication.** The signed-in member is
   the *actor*; the customer is the *subject*. Both are recorded.
2. **Notification follows attribution, but only across a real access
   boundary.** A subject receives updates only if they can actually access the
   organization. A bare email typed into a voter field never grants access and
   therefore never grants notifications.

## Product Decisions

### Attribution model

- Every on-behalf action resolves its subject to a **contact** (the
  workspace-scoped customer record) before anything is written.
- When an action needs a user row (votes and comments require one), the
  resolver provisions a **shadow user**: an attribution-only account that can
  never authenticate. No existing table constraint changes.
- Posts keep their existing dual-track authorship
  (`creatorId` / `creatorMemberId` / `contactId`).

### Roles

- Follow the two-layer permission convention in `docs/permissions.md`.
- Voting on behalf is already documented as an all-role capability; it ships as
  the named permission `votes.onBehalf` granted to contributor and above.
- Creating posts or comments on behalf ships as `posts.createOnBehalf` and
  `comments.createOnBehalf`, granted to manager and above, matching the
  curation rows in the matrix (change ETA, owner, status).
- The matrix gains explicit rows for all three when shipped; no generic
  permission is reused.

### Provenance

- `post.source` stays `DASHBOARD`. On-behalf creation happens in the dashboard;
  introducing a new source literal would fork every source-based filter.
- Provenance lives in activity metadata: `post_activity.metadata` records the
  actor/subject relationship, and the timeline renders
  "created by Sarah on behalf of john@acme.com".

### Notification eligibility

- Before any post-update email materializes for a recipient, the dispatcher
  checks organization access, statelessly, per delivery — exactly where plan,
  consent, and suppression are already re-checked.
- A recipient has organization access when their account is email-verified
  **and** any of the following holds:
  - They have a `member` row in the workspace.
  - They are bound to the workspace through SSO
    (`user.restrictedToOrganizationId` equals the organization id).
  - They are an unrestricted global user and the post's board is `PUBLIC`.
- Everyone else — including manually added voters who exist only as a contact
  plus shadow user — receives nothing until they gain real access.
- In-app notifications are unchanged: they remain member-only.

### Added-voter subscriptions

- Adding a voter on behalf is an explicit admin statement that this person
  cares about the post, so it creates a post email subscription with a new
  source value `admin_added_voter`.
- Self-service voting continues to never subscribe anyone; the existing
  subscription policy for ordinary votes and comments is unchanged.
- Subscriptions for subjects without verified accounts are created in a
  deferred state and activate when the identity links (see Identity linking);
  no verification email is sent to inaccessible recipients.

### Surface

- Dashboard RPC only in this version. The resolution service is transport-
  agnostic so a public API can reuse it later without rework.

## Existing Foundation

The feature assembles from parts that already exist:

- `post` already carries `creatorId`, `creatorMemberId`, `contactId`, and a
  `source` vocabulary; the widget flow already creates posts attributed to a
  contact with no session user.
- `contact` is org-scoped with unique `(organization_id, email)` and
  `(organization_id, external_id)`; `upsertContact` matches by external id or
  email inside the org.
- The SSO portal flow already provisions restricted users with synthetic
  emails and linked contacts, and `linkAnonymousAccount` already reassigns
  contacts, posts, and subscriptions when a restricted identity merges into a
  real account.
- The email outbox auto-subscribes post creators (`post_creator` source) and
  fans status changes out through intents and deliveries.
- `upvote` enforces one vote per user per post via a unique index, and the
  toggle repository already treats conflicts as no-ops.

Gaps: vote and comment handlers hardcode the session user; there is no
user/contact search endpoint; no on-behalf permissions exist; notification
recipient resolution has no access concept beyond membership.

## Architecture

```text
Dashboard RPC (PostCreate / CommentCreate / UpvoteAddOnBehalf …)
  -> ResolvePrincipalService            (same transaction as the mutation)
       input:  { userId? | contactId? | externalId? | email + name? }
       output: { contactId, userId }
       find-or-create; never fails on "no match"
  -> product mutation attributed to the resolved subject
  -> post_activity records actor (member) + subject + provenance metadata
  -> subscriptions recorded per policy

Email outbox dispatcher / delivery workflow
  -> existing plan, consent, suppression checks
  -> NEW: organization-access eligibility check per recipient
```

### Resolution priority

`userId` > `contactId` > `externalId` > `email`. Explicit identifiers win over
searchable ones; email is the find-or-create key of last resort. An absent
author object means "the session user" — every existing caller is unaffected.

### Resolution rules

| Input resolves to | Behavior |
| --- | --- |
| Existing contact picked from search | Use it. If the action needs a user row and `contact.user_id` is null, provision a shadow user and link it. |
| Email matches an existing global user, no contact in this org | Create a contact linked to that user (`contact.user_id` set). Their votes are real user votes. |
| Email matches a contact in another org only | Create a fresh contact in this org. Contacts are org-scoped by design. |
| Email belongs to a workspace member | Allowed, but the activity metadata and UI badge it as staff attribution. |
| No match anywhere | Find-or-create: new contact, plus a shadow user when the action needs one. Nothing is ever emailed to them at creation time. |
| Same voter added twice | Idempotent success no-op via the existing unique index and conflict handling. |

### Shadow users

- Synthetic email `behalf-<random>@feeblo.com`, `emailVerified = false`,
  `restrictedToOrganizationId` set to the workspace.
- Distinct prefix from SSO portal users (`sso-*`, whose addresses are verified
  by the customer's identity provider) so operators and the linking pass can
  tell attribution-only accounts apart.
- No credential or OAuth account rows are ever created for them, so they cannot
  authenticate. Name and avatar are copied from the resolution input onto the
  contact; display surfaces prefer the contact.

## Data Model Changes

Names follow repository conventions; vocabularies are Effect Schema literals
over plain-text columns, so most additions need no column migration.

### `post_activity`

| Column | Purpose |
| --- | --- |
| `metadata` | New nullable jsonb. For on-behalf actions: `{ onBehalfOf: { contactId, userId? }, actorMemberId }`. |

New activity kinds appended to the `PostActivityKind` vocabulary:
`VOTE_ADDED`, `VOTE_REMOVED`.

### `email_subscription`

Extend `EmailSubscriptionSource` with `admin_added_voter`. Extend the
subscription state vocabulary with `deferred_no_access`: created for a subject
without a verified account, never emailed, activated by identity linking.

### Search indexes

A migration enables `pg_trgm` and creates GIN indexes on
`contact.email`, `contact.name`, and `company.name` for the picker query.

### Unchanged on purpose

`upvote.user_id` and `comment.user_id` stay `NOT NULL`; shadow users satisfy
them. `post.source` gains no values.

## RPC Surface

All under `AuthMiddleware` with named-permission policies.

| RPC | Change |
| --- | --- |
| `PostCreate` | Payload gains optional `author` object. Present ⇒ requires `posts.createOnBehalf`; absent ⇒ current behavior. |
| `CommentCreate` | Payload gains optional `author` object. Present ⇒ requires `comments.createOnBehalf`. |
| `UpvoteAddOnBehalf` (new) | Adds one voter for a resolved subject; requires `votes.onBehalf`; idempotent. Deliberately not a toggle — an admin must not remove someone else's vote by accident. |
| `UpvoteRemoveOnBehalf` (new) | Removes one voter; requires `votes.onBehalf`. |
| `ContactSearch` (new) | Powers the picker; see Search. |

The shared author object:

```ts
author?: {
  userId?: string      // feeblo user id
  contactId?: string   // picked from search
  externalId?: string  // customer's id in their system
  email?: string       // find-or-create key
  name?: string
  avatarUrl?: string
}
```

## ResolvePrincipalService

One domain service in `packages/domain/src/identity/`, used by all three
features, always inside the product transaction:

1. Normalize the email (lowercase) when present.
2. Resolve in priority order: load user by id; load contact by id within the
   org; match contact by external id or email within the org; fall back to
   global-user lookup by email hash; otherwise treat as new.
3. Guarantee a contact exists for the subject in this org, creating or
   enriching one (name, avatar, external id) as needed.
4. If the action needs a user row and the contact has none, provision the
   shadow user and set `contact.user_id`.
5. Return `{ contactId, userId }`.

Failure modes are typed: invalid identifiers surface as existing tagged
not-found/bad-request errors; "no match" is not an error.

## Search

`ContactSearch` backs a debounced combobox in three places (create dialog,
voter panel, comment composer).

- Query matches `contact.email`, `contact.name`, and `company.name` using
  case-insensitive prefix and substring patterns supported by the trigram
  indexes.
- Ranking: exact email hit, then email prefix, then name prefix, then
  substring. An exact email pins its result immediately.
- Results carry `contactId`, linked `userId`, name, email, avatar, company,
  and badges: `isMember`, `alreadyVoted` (when `postId` is supplied),
  `hasAccess` (drives the "will/won't be notified" hint).
- Strictly scoped to the caller's organization, members included. The global
  user table is never searched across workspaces; cross-context matches are
  handled at submit time by the resolver, not in search results.
- Limits: default 10, maximum 25; dashboard read-level rate limit applies.
- Client guidance: 150–250 ms debounce, minimum two characters, keyboard
  navigation.
- Empty state is the find-or-create entry point: "No match — add
  jane@acme.com as a new customer."

## Notifications

- On-behalf post authors with verified accounts are subscribed exactly like
  self-service creators (`post_creator` source, trusted because the account
  email is verified).
- Authors and voters without verified accounts get `deferred_no_access`
  subscriptions. The dispatcher skips them; nothing is sent — including
  verification requests — until access exists.
- The eligibility check lives beside plan/consent/suppression checks in the
  delivery path, so a recipient who gains access later starts receiving
  subsequent updates with no backfill and no state change.
- Status-change fan-out, coalescing, merge/close intents, and unsubscribe are
  all inherited unchanged from the outbox design.

## Identity Linking

When a shadow user's human eventually shows up with a real account, the split
must heal automatically:

- Extend the `linkAnonymousAccount` machinery with two additional triggers:
  account signup and email verification, matched by contact email across the
  signer's organizations where `contact.user_id` points at a `behalf-*`
  shadow.
- The existing reassignment transaction already covers contacts, posts, and
  subscriptions; extend it to votes and comments (both keyed on the shadow
  user id), then delete the shadow user.
- Activation: `deferred_no_access` subscriptions for the linked contact become
  active if the surviving account satisfies eligibility.
- SSO session creation for a matching email takes the same path.

## Abuse and Cost Controls

- `ContactSearch` behind the dashboard read rate limiter.
- Per-member rate limits on on-behalf creations (posts, voters, comments).
- Contact find-or-create cannot overwrite an existing contact's identity
  fields except empty name/avatar enrichment.
- Staff-attribution badge prevents silent impersonation of members.

## Testing Strategy

### Resolver tests

- Each resolution-matrix row, including priority ordering when multiple
  identifiers are supplied simultaneously.
- Shadow provisioning is race-safe: concurrent resolutions of the same email
  produce one contact and one shadow user.
- Member-email attribution is allowed and badged.

### Feature tests

- Post on behalf writes creator fields, contact link, activity metadata, and
  integration event with the admin as actor.
- Voter add is idempotent; remove deletes only the subject's vote; both write
  activity kinds with provenance.
- Comment on behalf renders the subject as author on public boards while
  internal-comment visibility rules hold.
- Permission denials for each new action at each role.

### Notification tests

- Deferred subjects receive nothing while ineligible.
- A subject who signs up starts receiving subsequent status changes without
  manual action.
- Self-service voting still subscribes nobody.

### Linking tests

- Signup with a contact's email reassigns posts, votes, comments, and
  subscriptions off the shadow user and deletes it.
- Reassignment runs in one transaction; partial states are impossible.

### E2E

- Create-on-behalf from the dialog, add a voter from the picker, verify the
  timeline shows provenance, verify no email leaves for an inaccessible
  subject, verify an eligible subject receives a status-change email.

## Implementation Slices

Each slice is test-first and leaves the system deployable.

1. **Resolver core** — `ResolvePrincipalService` with the full resolution
   matrix against a test database; no RPC wiring yet.
2. **Schema groundwork** — migration for trigram indexes and
   `post_activity.metadata`; vocabulary additions (activity kinds,
   subscription source and state); shadow-user provisioning helpers.
3. **Posts on behalf** — `PostCreate.author`, policy, provenance metadata,
   creator subscription handling for eligible and deferred subjects.
4. **Voters on behalf** — `UpvoteAddOnBehalf` / `UpvoteRemoveOnBehalf`,
   `admin_added_voter` subscriptions, activity kinds.
5. **Comments on behalf** — `CommentCreate.author` and policy.
6. **ContactSearch** — repository query, RPC, policies, rate limiting.
7. **Identity linking** — signup/verification/SSO triggers, vote and comment
   reassignment, deferred-subscription activation.
8. **Dispatcher gate** — organization-access eligibility beside the existing
   delivery checks.
9. **Dashboard UI** — author section in the create dialog, voter panel
   add/remove, comment-as-customer option, timeline provenance rendering,
   shared combobox component in `packages/post-ui`.
10. **Docs** — `docs/permissions.md` matrix rows, `docs/notifications.md`
    eligibility contract, glossary entries for principal, subject, shadow
    user, and deferred subscription.

## Non-goals for the First Version

- Public REST/API parity for on-behalf operations.
- Bulk voter import.
- Manual contact merge tooling (automatic linking only).
- Verification or confirmation emails to inaccessible recipients.
- Widget or integration-surface on-behalf creation.
- Full impersonation (acting inside the product *as* the customer's session).

## As-built deviations

Decisions above held; implementation diverged in these places, all recorded
in code comments and `docs/on-behalf.md`:

1. **Gate ordering and external subscribers.** The eligibility gate runs
   *after* the consent check, not before it. Verified double-opt-in external
   subscribers without any account keep their consent-based delivery — the
   product rule targets on-behalf attribution, not opt-in broadcasts. The
   gate restricts only recipients whose account resolves; changelog topics
   are out of scope entirely.
2. **SSO trigger is an in-place promotion.** When `upsertSsoUser` matches a
   `behalf-*` shadow by (email hash, organization), the shadow row itself
   becomes the portal identity (fresh synthetic `sso-*` address,
   `emailVerified = true`) rather than being moved to a new user and deleted.
   Identical end state, zero data churn.
3. **Email subscriptions are email-contact-keyed.** Linking moves the
   identity reference on the `email_contact` row and activates
   `deferred_no_access` subscriptions by claiming that contact for the
   surviving account when eligibility holds.
4. **Shadow deletion stays with the caller.** The existing plugin deleted
   restricted users itself after linking (skipping cleanup on failure so data
   survives for retry); the generalized program therefore takes a
   `deleteShadowUser` flag instead of always deleting.
5. **Post subscriptions needed vote-style collision handling too** — they
   share the `(post_id, user_id)` unique-index shape the ticket flagged only
   for votes.
6. **`identity/emails.ts`** holds the synthetic-email predicates as a
   dependency-free module to avoid a user-repository import cycle.
7. **Glossary location.** `CONTEXT.md` is scoped to the integration platform
   domain, so the feature vocabulary (actor/subject, shadow user, deferred
   subscription) lives in `docs/on-behalf.md` instead.
8. **Picker `hasAccess` without post context.** With no `postId`, an
   unrestricted verified global user is reported eligible (board unknown);
   with `postId`, board visibility participates in the verdict.

## Completion Criteria

- A member can attribute a post, vote, or comment to any resolvable customer
  without leaving the dashboard, and every such action is auditable as
  actor-plus-subject.
- No recipient ever receives post email without organization access, and
  gaining access starts delivery without operator intervention.
- Shadow identities heal into real accounts automatically on first contact.
- All three capabilities are gated by named permissions consistent with the
  documented matrix.
- The picker returns relevant matches in a single round trip and makes the
  create-new path obvious when nothing matches.
