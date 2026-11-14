# ADR 0028: Code mode is a second MCP projection over the same registry

## Decision

`POST /mcp/code` serves the Public API as exactly two tools — `search` and `execute` — and every call a program makes goes through the operation registry ADR 0007 made the unit and the handlers ADR 0008 already projects.

- **`search` derives from `PublicApiOperations`.** `public-api/catalog.ts` prints each operation's TypeScript signature from the operation's own input and output schemas (`Schema.toJsonSchemaDocument`), and ranks the catalog deterministically: token matches in the name outweigh matches in the description, and an exact name always ranks first. No embeddings, no index, no second source of truth — a new operation appears in `search` with no edit to the catalog.
- **`execute` runs one program.** The tool's input is a JavaScript function body; the sandbox gives it an async context with a `tools` object in scope, so `await tools.listPosts({ limit: 5 })` calls the same handler `/api/v1` and `/mcp` call.
- **The call path is the operation's own.** `code-mode.ts` looks the name up in the registry, decodes the input with `operation.input`, runs `operation.handler` (which is wrapped by `defineOperation`, so `requirePublicApiScope` runs), and encodes the result with the operation's output schema. There is no second implementation of any operation, and a change to one reaches all three surfaces.
- **A failed call is a thrown error, not an aborted program.** `SandboxProgram.call` fails with `SandboxToolFailure`, which the sandbox surfaces inside the program as an `Error`. A program can catch `FORBIDDEN_SCOPE`, try another call, and still return an answer — which is the point of one program replacing several round trips.
- **The destructive gate is shared.** A program's destructive call asks the same `Approval` service `/mcp` asks, so `MCP_APPROVAL=deny` refuses a delete whether it arrives as a tool call or inside a program. The refusal is observable inside the program rather than fatal to it.
- **The executor is a port.** `public-api/sandbox.ts` declares `Sandbox`; `public-api/sandbox-node.ts` is the Node implementation, and the route's layer requires the port rather than the implementation. `apps/server` supplies `NodeSandboxLive` and the `NodeServices` layer it needs.

The Node sandbox is a **separate process** started with `--permission` (no file system, network, child process, worker, or native addon grant) and an empty environment, running `node:vm` with `codeGeneration: { strings: false, wasm: false }`. Every function the program can reach — `console`, `tools`, the tool-call bridge — is created **inside the sandbox's realm**, so the `console.log.constructor("return process")` family of escapes resolves the realm's `Function` constructor and is refused; only JSON strings cross from the host. `process`, `require`, and `fetch` are not in its global object. The parent talks to it over newline-delimited JSON on stdin/stdout: program in, `call` messages out, decoded results back, with every frame bounded before it is parsed. Limits are explicit — 10 s wall clock, 1 s per synchronous evaluation, 100 tool calls, 200 log lines, 100 000 result characters, a 128 MB V8 heap plus a 256 MB RSS watchdog, and a 1 MiB frame — and the child is killed when the request's scope closes, so an interrupt cannot orphan a program.

## Why

**Forty tools is the wrong prompt for a task.** `/mcp` answers "what can this workspace do" well: one tool per operation, each with its own schema, so a client that calls one operation at a time reads one schema at a time. An agent with a job — "file this bug on the right board with these tags" — pays for that shape twice: it reads every schema it might need, then makes a round trip per call. `search` narrows the list to the few operations a task needs, `execute` turns the chain into one call, and the model — not the server — decides when code mode is worth it. That is why this is a **second endpoint rather than two extra tools on `/mcp`**: a client that wants the per-operation list must not have its tool list change underneath it, and the choice between the two shapes belongs to the client.

**The program is untrusted code, so the executor cannot be the server process.** `node:vm` in-process is a well-known non-boundary: one escape yields the server's environment, database handle, and API keys. A separate process is the minimum structural separation, and it can be killed — but Node's permission model is **not a security guarantee against malicious code**: Node documents it as a guard against accidental damage, and it has had bypasses. What protects the deployment is the process boundary plus the OS-level isolation around it (the container's kernel and cgroup limits), and a deployment that needs a hard guarantee against untrusted programs should give the child its own sandbox — a container or VM with no network and no credentials — rather than rely on the permission model alone. The limits (wall clock, evaluation, calls, result) bound the work the process can do before the parent gives up on it, and the `ppid` check in the runner means a dead parent does not leave a program running.

**A port keeps the security decision out of the surface.** `execute` needs "run this string and hand me back JSON"; it does not need Node. A Worker, a container, or a remote executor can satisfy `Sandbox` without touching `code-mode.ts`, and the unit tests do exactly that with the real implementation only in the integration suite.

**The catalog is derived, and determinism is a feature.** The signatures are printed from the schemas the operations validate with, so the hint a model reads cannot disagree with what the handler accepts. Ranking is a pure function of the query and the registry, so a model that found a tool once finds it again; an embedding index would add a provider, a build step, and a class of "it worked yesterday" failures to a forty-entry list.

**Approval had to follow the program.** Introducing code mode without extending the approval gate would have made `/mcp/code` the way around `MCP_APPROVAL=deny`: the same delete, one indirection away. The gate is called at the tool-call boundary inside the sandbox, so the deployment's decision is the same on both surfaces and the program sees the refusal as a catchable error rather than a dead run.

## Consequences

`/mcp/code` publishes two tools and one surface-local failure vocabulary: `SANDBOX_ERROR` for a run that failed (limit, crash, unrepresentable result) and a thrown `SandboxToolFailure` inside a program for a call that was refused. Neither is added to `PUBLIC_API_ERROR_CODES`; `/api/v1` cannot produce them (ADR 0004).

`MCP_APPROVAL` now governs both endpoints. Its default (`allow`) is unchanged, so introducing code mode does not change an existing deployment's behaviour; `deny` and `ask` apply to destructive calls made directly and from programs.

The sandbox is not free: each `execute` starts an interpreter. That is the cost of a real boundary, and the wall clock includes it.

A program's result is JSON. A successful operation's decoded value is encoded with its published output schema before the program sees it, so a model works with the same DTOs `/api/v1` returns; a result that cannot be represented fails with `UNREPRESENTABLE_RESULT`.

`docs/adr/0008` remains the per-operation projection's decision record; the two surfaces share the registry, the handlers, the credential, the rate-limit budget, the plan gate, and the approval gate, and differ only in how many calls a client makes.

## References

- `packages/domain/src/public-api/code-mode.ts` — the toolkit and route.
- `packages/domain/src/public-api/catalog.ts` — signatures and ranking.
- `packages/domain/src/public-api/sandbox.ts` — the port, limits, and failure vocabulary.
- `packages/domain/src/public-api/sandbox-node.ts` — the subprocess implementation.
- `packages/domain/src/public-api/approval.ts` — the gate both MCP endpoints ask.
- [rat-stack](https://github.com/joelhooks/rat-stack) — the capability-to-code-mode projection this borrows its shape from, MIT licensed.
