# On-behalf attribution

Workspace members can create posts, add voters, and publish comments that are attributed to a customer instead of to themselves — typically feedback that arrived on another channel (email, call, ticket). This page is the canonical reference for how attribution, access, and notification delivery work. A reader should be able to answer "who gets notified, and why?" from this page alone.

## Vocabulary

- **Actor** (principal): the authenticated staff member performing an action. Always recorded for audit (`post_activity.actorId` / `actorMemberId`).
- **Subject**: the customer an action is attributed to. Always resolved to a **contact** — the workspace-scoped customer record (`contact` table, unique `(organization_id, email)` and `(organization_id, external_id)`).
- **Shadow user**: an attribution-only account (`user` row with a synthetic `behalf-*@feeblo.com` address, `emailVerified = false`, `restrictedToOrganizationId` set). Shadow users have no credentials, can never authenticate, and exist only so votes and comments — which require a `user_id` — can be attributed to customers who never signed up.
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
| No match anywhere | New contact, plus a shadow user when required. |

Subject fields never overwrite known contact data; they backfill empty name/avatar only. Inserts tolerate unique-index races by re-reading the winner.

## Permissions

Named permissions follow the two-layer model in `docs/permissions.md`:

| Permission | Minimum role | RPCs |
| --- | --- | --- |
| `posts.createOnBehalf` | manager | `PostCreate` with `author` |
| `comments.createOnBehalf` | manager | `CommentCreate` with `author` |
| `votes.onBehalf` | contributor | `UpvoteAddOnBehalf`, `UpvoteRemoveOnBehalf` |

Absent `author` objects mean "the session user" — every pre-existing code path is unchanged. Public-board RPC variants reject `author`.

Voter management is deliberately **not** a toggle: `UpvoteAddOnBehalf` is idempotent (a repeat add succeeds without a duplicate) and `UpvoteRemoveOnBehalf` deletes exactly one subject's vote, so an admin can never remove someone else's vote by accident.

## Provenance

`post.source` stays `DASHBOARD`; on-behalf facts live in `post_activity.metadata` as `{ onBehalfOf: { contactId, userId? } }` with the admin recorded as the actor. Activity kinds `VOTE_ADDED` / `VOTE_REMOVED` record voter management. Timelines render "created by Sarah on behalf of john@acme.com".

## Notifications

In-app notifications are unchanged: recipients are workspace members only.

Email follows attribution. Post creators are auto-subscribed (`post_creator` source); a voter added on behalf is explicitly subscribed (`admin_added_voter` source); self-service voting and commenting subscribe nobody.

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

Split identities therefore cannot persist: the first time the customer signs up with the email an admin typed, all their attributed history moves to the real account.

## Picker search

`ContactSearch` backs the author/voter/commenter comboboxes: org-scoped, single-round-trip SQL ranked exact email → email prefix → name prefix → substring over trigram indexes, returning `isMember`, `hasAccess`, and `alreadyVoted` badges so the UI can hint "will/won't be notified" before submitting. Without post context the board is unknown, so `hasAccess` for an unrestricted verified global user is provisional — eligibility cannot be determined until the post's board visibility is known (callers with a post pass `postId`). An empty result is the create-new-customer entry point.

## Where things live

| Concern             | Path                                           |
| ------------------- | ---------------------------------------------- |
| Resolver            | `packages/domain/src/identity/service.ts`      |
| Linking             | `packages/domain/src/identity/linking.ts`      |
| Access evaluation   | `packages/domain/src/email-outbox/access.ts`   |
| Delivery gate       | `packages/domain/src/email-outbox/workflow.ts` |
| Shadow provisioning | `packages/domain/src/user/repository.ts`       |
| Plan and decisions  | `plan-on-behalf.md` (repo root)                |
