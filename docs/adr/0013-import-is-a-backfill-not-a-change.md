# ADR 0013: An import is a backfill, not a change

## Decision

A board CSV import is a historical bulk load, not a sequence of live changes, and the shared post write path treats it that way. `PostCreateWrite`'s create takes `mode: "interactive" | "backfill"`; in `backfill` mode it skips the on-behalf abuse bound, the `post.created` integration event, the creator's in-app and email subscription, the submission-notification window, and the per-request embedding job. The post itself — slug, sanitized content, board, status, author resolution, and its `POST_CREATED` timeline entry — is produced identically in both modes.

Import is **create-only**: an import never updates or matches an existing post. The CSV contract therefore has no post `id` column, and exporting a board and importing the file again produces a second set of posts rather than editing the first. Re-uploading the same bytes warns on the preview — the job stores the file's SHA-256 — but does not block.

An import is a durable job, not a request. The upload parses, validates, and stages every row in one transaction, then waits for a person to confirm the preview; a lease-based worker claims confirmed jobs and applies rows one transaction at a time. The row ledger is the checkpoint: a pass only ever applies `pending` rows, so a crashed pass (whose lease expires and is re-claimed) or a repeated pass can never create a post twice. Rows that fail are recorded with a static, field-scoped message and the pass continues; a pass that fails for an infrastructure reason is marked failed rather than retried in a hot loop, and the posts it already created are kept.

The file bytes are never persisted. Tags and boards are resolved and created once per batch outside the row transactions; authors are resolved through the same `resolveOnBehalfSubject` seam the dashboard and the Public API use, so an imported post is attributed to a contact exactly as an on-behalf post is.

## Why

The two shapes are different products. An interactive create is a single fact that other systems want to hear about the moment it happens; an import is 20,000 facts that were already true somewhere else, and firing 20,000 webhooks, emails, and embedding jobs for them is not a feature — it is an outage aimed at the workspace's own subscribers and at the embedding provider. The suppression list is exactly the write path's person-shaped and notification-shaped side effects; what remains is the post and its history.

Create-only follows from the same reasoning. An upsert needs an identity for a post that a foreign CSV does not have, and inventing one (a slug match, a title match) silently rewrites a post a person edited. A migration that duplicates on a mistake is recoverable; one that silently overwrites is not. The file-hash warning is the guard against the mistake that actually happens, which is importing the same file twice.

The job ledger is chosen over the alternatives for resumability. A streamed import inside one request holds a transaction for minutes and cannot report progress; a workflow engine would replace the row ledger's per-row outcome with engine state the report cannot show. The repository's existing lease-claim worker (`integrations/core/src/integration-delivery-worker.ts`) is the pattern already in the codebase for "durable, batched, resumable work".

## Consequences

`post_activity` records `POST_CREATED` for every imported post, attributed to the member who uploaded the file when their account still exists and to nobody (`kind: "import"`) otherwise. Webhook consumers do not learn about imported posts; the report and the Public API are how they catch up, and the import UI says so before the file is chosen.

Contacts created for imported authors carry whatever `source` the identity resolver assigns; the resolver's input contract does not name a source, and `post.source` is the provenance the feature owns. Changing the resolver was rejected as a wider change than the feature needs.

`DATA_IMPORT_MAX_ROWS` / `DATA_EXPORT_MAX_ROWS` bound both directions at 20,000 rows, with a 10 MB upload cap enforced while the multipart body is streamed to disk. An export past its cap fails before the first byte is written, so "too large" stays an ordinary error response rather than a truncated download. Import jobs and their row reports are deleted 30 days after creation, matching delivery retention.
