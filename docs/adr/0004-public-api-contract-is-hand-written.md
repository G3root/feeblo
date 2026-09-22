# ADR 0004: The Public API contract is hand-written

## Decision

Public API request and response schemas are hand-written, closed structs in `packages/domain/src/public-api/schema.ts`. The public module shares repositories with the rest of the domain but never imports a dashboard or portal response schema (`post/schema.ts`, `widget/schema.ts`, `public-actor.ts`), and never imports the session middleware; an `oxlint` boundary override enforces both, and the credential seam it _does_ need was moved to `packages/domain/src/auth-handler.ts` so the ban can cover the whole session module. The published OpenAPI document for `/api/v1` is a separately curated contract, asserted against the declared field set and the endpoint list.

## Why

`PostListItem` — the projection the dashboard and the public portal share — carries `creatorId` and `creatorMemberId`, internal `usr_*` and `mem_*` identifiers that `public-actor.ts` states must never be exposed. Its existing escape hatch, `redactCreatorIdentity`, nulls rather than omits those fields and is session-aware: it keeps the current user's own identifiers. A machine key has no session user, so that path either redacts everything or requires inventing an actor. Reusing it would make a portal-runtime concern the Public API's safety mechanism, and a field later added to `PostListItem` would silently widen the public payload.

Sharing would also save nothing. No post read model carries vote or comment counts — the only aggregate query in the codebase is the OG-image upvote count — so the public list projection is new work regardless of whether the response type is shared.

## Consequences

Dashboard and Public API payloads drift on purpose. Adding a field to a public response is always two edits — the DTO and the mapper — and therefore visible in review. The payload's field set is pinned by tests (`api-contract.test.ts` derives it from the published document, `mappers.test.ts` asserts it on the mappers), and `api-live.test.ts` greps the serialized response for actor identifiers, so unintended widening fails rather than shipping. The public module cannot import the session middleware at all, so a key can never be resolved into a `CurrentSession` by accident.
