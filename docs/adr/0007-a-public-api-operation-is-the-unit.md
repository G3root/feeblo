# ADR 0007: A Public API operation is the unit, and HTTP is one projection of it

## Decision

The Public API's behavior is declared as per-resource **operations**, and every surface is a projection of the same operation.

- An operation lives in `packages/domain/src/<feature>/public-api/operations.ts` and carries a name, a description, a typed input schema, an output schema, a failure schema, its `PublicApiScope`, MCP-style annotations (`readOnly`, `destructive`, `idempotent`, `openWorld`), and a handler that returns the published DTO. `defineOperation` (`public-api/operation.ts`) wraps every handler in `requirePublicApiScope`, so the scope check is part of the operation and no projection can forget it.
- HTTP is a projection: `<feature>/public-api/http.ts` declares the `HttpApiEndpoint`s and the handlers that parse the HTTP input (query strings, path parameters) and call `operation.handler`. The published OpenAPI document, status codes, and error envelope are unchanged; the `*Query`/`*Params`/`*Payload` schemas stay where they were, because they are HTTP shapes.
- Composition is per resource. `api-contract.ts` spreads the endpoint arrays, `api-live.ts` merges the handler records, and `router.ts` merges the per-resource repository layers. Adding an endpoint to a resource is an edit inside that resource's folder; adding a whole resource is one line in each of those files, and nothing else.
- `public-api/operations.ts` is the registry a non-HTTP surface iterates. A test (`operations.test.ts`) pins it to the published endpoint set, so the two cannot cover different sets.
- Storage is shared with the RPC side wherever the operation is the same. `TagRepository` owns the safe tag assignment (post lock, diff, only-changed rows, provenance preserved) and the dashboard handler uses it too; `CompanyRepository` owns the paging, the conflict lookups, and the CRM entry count; `ChangelogRepository` owns the row writes; post writes (`post/write.ts`) and comment writes (`CommentService`) were already shared. The tag and company public repositories are gone — their operations call the shared repository directly and keep only the cursor handling and the published error vocabulary. Where a public projection is genuinely different (the post and comment reads that must not select actor identifiers, the changelog publication orchestration), the feature keeps a `public-api/repository.ts` and its own narrow row type.
- `router.ts` provides `PublicApiInternals` into the request context (`Layer.provide`, not `provideMerge`), because the operations read the shared repositories and the database handle from the fiber context the same way they read the caller and the config. Without it, `currentTagRepository` and `currentCompanyRepository` would be absent at request time while the layers sat right beside them.

The `eslint/no-restricted-imports` override that enforces ADR 0004 covers both `public-api/**` and `*/public-api/**` and names the dashboard modules' paths relative to each (`../schema` from a feature slice, `../post/schema` from the root), rather than `**/post/schema`, which matched the Public API's own contract.

## Why

Three problems, one shape.

**The surface was entangled with HTTP.** Every handler did its own parsing, its own scope check, and its own business logic in one `HttpApiBuilder` chain. Adding MCP meant either reimplementing each handler or reaching into the HTTP layer, and the two copies would drift the first time one changed. The rat-stack scaffold (`joelhooks/rat-stack`) demonstrates the alternative: declare a capability once with its schemas and annotations, then project it onto a CLI, an HTTP API, and an MCP toolkit. The operation is that declaration; the HTTP endpoint is one projection of it, and a future MCP server derives its tools from the registry without restating a branch.

**Two changes to the Public API collided in four files.** `api-contract.ts`, `api-live.ts`, `schema.ts`, and `repository.ts` were single files holding every resource, and they were the four files every feature branch edited. Splitting by resource makes an endpoint an edit in one folder, which is the difference between a merge and a rebase.

**The Public API re-derived what the dashboard already had.** Tag, company, and changelog CRUD existed twice: once in the entity repository the RPC handlers call, once in the public repository with slightly different return values. The two copies were not free — the public tag write was the _safer_ one (it locks the post, writes only changed rows, and preserves merge provenance) while the dashboard's was the simpler one. Sharing the repository is what lets one implementation be the authority.

## Consequences

The HTTP contract is unchanged: the published document, response bodies, error codes, and cursor behavior are the ones the existing tests pinned, and those tests pass against the split without modification beyond import paths.

Adding an endpoint is now: an operation in `<feature>/public-api/operations.ts`, a handler and endpoint in `<feature>/public-api/http.ts`, and whatever new schema it needs in `<feature>/public-api/schema.ts`. Nothing shared is edited unless the feature is new. The registry parity test fails if the operation and the endpoint sets diverge.

A non-HTTP surface is a projection over `PublicApiOperations`, not a second implementation. The operation's typed input is what an MCP tool advertises, its annotations are the tool hints, and its handler already enforces the scope. The MCP server itself — transport, key binding, and how a workspace's scopes are presented to a client — is not part of this decision and remains future work.

The public repositories that remain are `provideMerge`d rather than only provided, because their tests drive them directly to reach races the HTTP surface cannot produce (ADR 0006). A new feature is one line in `operations.ts`, one in `api-contract.ts`, one in `api-live.ts`, and one in `router.ts`; an endpoint added to an existing feature edits none of them.

Widening a domain repository's input from a branded id to `string` is part of the sharing: the dashboard decodes a branded id before it reaches the repository, while the Public API's key is scoped to one workspace and its ids come from the database. The repository takes the string; the decode that remains is the RPC payload's, where it belongs.
