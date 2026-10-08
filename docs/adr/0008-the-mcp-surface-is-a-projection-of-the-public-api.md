# ADR 0008: The MCP surface is a projection of the Public API operations

## Decision

The Public API is served over the Model Context Protocol at `POST /mcp`, and that surface is a projection of the same operation registry the HTTP endpoints are (ADR 0007).

- Every operation becomes one tool through `Tool.make`: the name, description, input, output, and failure are the operation's own schemas, and `Tool.Readonly`, `Tool.Destructive`, `Tool.Idempotent`, and `Tool.OpenWorld` are the operation's annotations. `Toolkit.make(...PublicApiOperations.map(toMcpTool))` in `public-api/mcp.ts` is the whole projection, and `McpServer.toolkit` registers it.
- The toolkit owns the protocol mechanics: it decodes a call's parameters with the tool's schema, encodes the success into `structuredContent`, encodes a declared failure as an `isError` result, and answers a parameter the schema rejects as an `InvalidParams` protocol error. No surface-specific handler exists.
- The key gate is a route-scoped `HttpRouter.middleware`, not an `HttpApiMiddleware`: the MCP transport registers its own route, so there is no HTTP API group to hang one on. It calls `authenticatePublicApiKey` — the key check extracted from the HTTP middleware into `public-api/api-key-auth.ts` — and provides the `PublicApiCaller` it returns to the tool handlers.
- `makePublicApiMcpRoute` composes the route, and `apps/server` mounts it beside `PublicApiRoute`. It requires the same shared services the HTTP route requires, and owns the same private bundle (`PublicApiInternals`, the public repositories, the comment write path).
- The transport serves revisions `2026-07-28` through `2024-11-05`, newest first, and does not enable cross-origin access: a request carrying an `Origin` header is rejected.

The scope a key holds is enforced by the operation's own `requirePublicApiScope`, and a call the key cannot make is a declared failure. `tools/list` returns every tool regardless of the key's scopes.

## Why

**The key check must not be answered twice.** A machine credential has four questions to pass — presence, verification, the per-key budget, and the plan gate — and the answers are the same for both surfaces. Keeping the check inside the HTTP middleware would have forced the MCP route to restate all four, and the first fix to any one of them would have reached a single surface. `authenticatePublicApiKey` is the unit; `public-api/api-key-auth.ts` is where it lives, and the HTTP middleware is now a thin security-scheme adapter over it.

**Annotations were already MCP vocabulary.** `PublicApiOperationAnnotations` was deliberately declared in the MCP annotation set (`readOnly`, `destructive`, `idempotent`, `openWorld`) rather than imported from the AI surface, so the projection is a mapping, not a re-description. Deriving the toolkit from `PublicApiOperations` also means the parity test that pins the registry to the published endpoint set (ADR 0007) is now a parity test for the tool set: a resource added to one surface is a tool on the other.

**Per-key tool filtering is not expressible, and is unnecessary.** An MCP server's tool list is a property of the server, not of a credential; making the list key-dependent would mean one server instance per key. The operation's scope check is the authority, so a key that lacks a scope still sees the tool and is refused when it calls it — with the scope named in the message, which is more useful to a model than a tool that silently does not exist.

**The erasure boundary is real and belongs in one file.** `Toolkit.make` needs a tool per operation and `toLayer` needs a statically keyed handler record, so `mcp.ts` erases each operation's input type and the key middleware's request-scoped caller while keeping every stable dependency in the layer's type. It is the one file with noted `oxlint-disable`s and a `SAFETY` comment; the rest of the surface is fully typed.

## Consequences

`public-api/mcp.ts` adds no schemas, no DTOs, and no error vocabulary. The tools a client lists, the calls it makes, and the failures it receives are the published `/api/v1` contract, so the two surfaces cannot drift into different answers for the same call.

Adding an operation adds a tool with no edit to this surface: the toolkit is built from the registry. Removing a tool is removing an operation, which the HTTP parity test also notices.

A parameter an operation's schema rejects is answered as an `InvalidParams` protocol error rather than an `isError` result — Effect's `Tool` semantics, and the behavior a client already expects from an MCP server. A declared failure (`FORBIDDEN_SCOPE`, `NOT_FOUND`, `CONFLICT`, …) is an `isError` result whose text is the failure's message.

A refused request — no key, an unknown key, an exhausted budget, a plan without the Public API — answers the `/api/v1` envelope with the status the failing schema's own `httpApiStatus` annotation publishes. Reading the status from the annotation rather than a second table is what keeps `/mcp` and `/api/v1` from answering the same refusal differently.

`docs/public-api.md` documents the surface for customers; there is no second MCP-specific contract document, because there is no second contract.
