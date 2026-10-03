# ADR 0010: An end user is addressable by its contact id

## Decision

The Public API publishes the workspace's own end-user record as a resource: `GET /api/v1/end-users`, `GET /api/v1/end-users/{endUserId}`, and `POST /api/v1/end-users` (an upsert keyed by `externalId` and `email`). Its `id` is the `cnt_*` contact id, and `PublicApiVote` carries the same id as `voterId`, `null` when a member cast the vote.

This narrows the previous blanket promise in `docs/public-api.md` — "internal actor identifiers — `usr_*`, `mem_*`, `cnt_*`" are never returned — to account identifiers: `usr_*` and `mem_*` are still never published anywhere. A contact id is published, and only where it addresses a customer. Email and phone remain accepted as filters and as upsert keys and are never returned.

The scopes are `end_users.read` and `end_users.write`, granted as one opt-in capability (`PUBLIC_API_END_USER_MANAGEMENT_SCOPES`), like the company grant.

## Why

The gap this closes is a migration one. An integration that syncs people starts by upserting its users, then names them on the posts, votes, and comments it writes. Our on-behalf `author` object already lets an integration _write_ as a customer without creating a user first — an improvement — but it could not _read_ the roster, reconcile an export, or maintain a mapping between its own user ids and ours. Every vote, comment, and post it wrote became unattributable back to its own records. That is what `end_users.read` is for.

The identifier choice is the part worth recording. Three shapes were available:

1. **No identifier at all.** The DTO carries name, avatar, company, and timestamps, and the upsert returns the record but nothing a caller can address it by. Reconciliation is impossible, which is the entire point of the endpoint.
2. **The caller's `externalId` only.** The path id would be a value the caller supplied, so it is not unique until the caller makes it so, and it is nullable for contacts created by an email vote.
3. **The contact id.** Stable, unique within the workspace, already the row's primary key, and the same identifier a vote can carry.

Option 3 is what shipped. The reason the original promise existed was not that `cnt_*` is secret — it is a per-workspace opaque string — but that a _payload about something else_ should not leak the actor behind a record. A dedicated resource is the opposite situation: the record is the subject, an identifier is what makes it addressable, and `end_users.read` is the gate. Publishing the same id on a vote is a smaller version of the same argument: a vote's voter is part of what a vote _is_, and without the join key an export has to page every end user to attribute a page of votes.

Email is the line that did not move. A key travels into third-party infrastructure — an integration platform, a partner's backend, a CI log — and an address book is a different blast radius from a signed-in session. A caller that needs to match people supplies the email; it never reads one back.

## Consequences

`docs/public-api.md`'s data-exposure section now distinguishes identifiers that address a customer (contact ids, and the `boardId`/`statusId`/`tagId` class) from account identifiers (`usr_*`, `mem_*`), which stay out of every payload. `voterId` on a vote is visible to any key, including the default read-only grant, but it resolves to nothing without `end_users.read`; the roster itself stays opt-in, exactly like companies.

`api-contract.test.ts` pins the end-user DTO's field set and asserts the email never appears in it, and `api-live.test.ts` asserts the same on the wire, so re-adding an email field fails rather than shipping. The `contact` table now has two public write paths that create rows — the on-behalf resolver and this upsert — and both write the same row with the same unique keys, so a customer created by one is the customer the other matches; the difference is that the resolver creates as a side effect of attributing something, while the upsert is the caller saying who the person is.
