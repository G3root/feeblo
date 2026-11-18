# ADR 0031: A provider import is an adapter onto the staged job

## Decision

An import source other than a file is an **import provider**: an adapter that pulls posts from an outside tool and returns the CSV parser's `ParsedBoardPostRow[]` plus a stable fingerprint and file-level notices. The rest of the pipeline is unchanged. `stageParsedRows` — board and status resolution, the plan, the row report, the confirmation gate, the worker and the 30-day retention — is the one implementation for both sources.

The dashboard reaches providers through two RPCs on the existing `DataTransfer` group:

- `ListDataImportProviders` returns a descriptor per registered adapter: name, tagline, the fields to render, a help link, what the import carries, and what it does not.
- `StartProviderDataImport` takes the provider id and a keyed credential record, fetches every post the credential can see, and returns the staged job summary.

There is no HTTP route for this. The dashboard's `/api/data/import` is a file transfer, and a provider API key must not travel through a route built to receive bytes the browser already holds.

Credentials are one-shot. The service hashes the provider's fingerprint into `data_import_job.file_hash` and labels the job `"<Provider> import"` in `file_name`; neither the credential nor a source column is persisted, so the feature needs no migration. The fingerprint is the sorted set of the provider's own post ids: re-importing the same set warns through the existing duplicate notice, and importing a set that changed is a different set with no false warning.

The adapter registry lives in `data-transfer/providers/index.ts` and is supplied to `DataImportService` as `ImportProviderRegistry`. Adapters own their transport, pagination, status mapping and failure vocabulary; they do no database work. The service checks the workspace's active-import slot _before_ calling an adapter, so a long pull is not run for a workspace that cannot stage its result. Network work happens before the transaction.

Three adapters ship:

- **Canny** uses its form-encoded `POST /api/v1/posts/list`, pages at 100 posts, maps Canny statuses onto this workspace's default status names (`open` → `Pending`, `complete` → `Completed`), and parses `February 2020` / `Q1 2020` etas into `YYYY-Qn`.
- **Nolt** reads a board's CSV export from `https://<board>.nolt.io/api/csv`, validates the host before sending the key, and maps the export's headers by alias because Nolt's column set is not stable across boards.
- **Productboard** reads `GET /v2/entities` for features, components and products, walks a feature's parents to name its component as the board, converts HTML descriptions to text, and skips archived features with a notice.

Every adapter turns `401`/`403` into a credential failure, `429` into a rate-limit failure carrying `Retry-After`, a `5xx` or transport error into an unavailable failure, and an unreadable body into a response failure. **Rate limiting is surfaced, not waited out**: the start RPC fails with the wait the provider asked for, and the form shows it. A pull that returns no posts fails with an empty-account message rather than staging a zero-row job.

## Why

The expensive and dangerous part of an import is not reading the source; it is interpreting a row (status, board, author, limits) and writing it once. A provider that invented its own planner would fork every one of those rules, and the sources would drift the first time a status default or a content limit changed. Returning the parser's row shape makes "a provider is another way to produce rows" structural rather than a convention.

A durable provider job was rejected. Resuming a provider pull needs the credential again, and storing a third-party API key only to make a retry convenient is a worse trade than asking for the key again. The pull happens in the request; the job it stages is durable exactly as a CSV job is.

A `source`/`provider` column on `data_import_job` was rejected for the same reason a provider table was: the report's job name already says where the import came from, and a migration is a production-irreversible change for a label. If filtering by source becomes a product need, that is the point to add the column, not before.

The catalog is an RPC rather than a constant in the web bundle so adding a fourth provider is a server adapter and a descriptor. The credential form renders whatever fields the descriptor names, and the card list grows without a web release.

Votes and comments are deliberately outside the contract. An imported post's upvotes would need an `upvote` row per voter, and those rows carry a user or member reference this import does not have; a synthetic voter would corrupt both the count and the workspace's membership. Comments have the same author problem plus threading. The adapter descriptors say both do not cross, before a credential is used, so the limit is a stated product decision rather than a surprise in the report.

## Consequences

Adding a provider is: an adapter module that validates its credentials, fetches its posts, maps them onto `ParsedBoardPostRow` and fails with the provider error vocabulary; a descriptor; and one line in the registry. It must not read the database, and it must not write a credential into a notice, a job name or an error message.

The provider import UI is the same staged job the CSV path produces. A staged provider job has a preview, a row report, a confirmation and a worker pass, so the only new dashboard surface is the source cards and the credential dialog. A dialog closes on success and the review page is where the person confirms; nothing a provider returns is written before that.

Pacing many pages against an hourly plan limit is deliberately not solved here; a future durable import would have to solve it without storing the key, which is the reason it is not in this version.
