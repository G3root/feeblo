# ADR 0006: A surface owns its composition

## Decision

An API surface in `packages/domain` defines its own composition, in its own module, and draws one line through its dependencies:

- **Private layers are closed over.** The layers only that surface reads are merged into a bundle the surface provides to itself. The Public API's is `PublicApiInternals` in `packages/domain/src/public-api/router.ts`: the email outbox, the notification fan-out, and the post-activity repository — the write-path side effects it performs, which no other surface reads through it.
- **Shared layers stay requirements.** Everything the surface shares with the rest of the server remains in its layer type: the database, `Auth`, the rate limiter, the plan decision, media storage, and the surface's own config. The composition root supplies the real service; a test supplies its substitute (`S3Test`, a smaller rate-limit budget, `PublicApiConfig.layerTest`). Neither restates the surface's private wiring.
- **A capability shared by several surfaces owns its composition once.** `PostWriteService` (`packages/domain/src/post/write.ts`) captures its required collaborators and provides them to every operation, so the dashboard RPCs, the Public API, the widget, and the Slack and Discord inbound feedback services depend on one tag and the root supplies the one instance. Its optional fan-outs — notifications, embeddings, the rate limiter, the outbox wake — stay per-operation reads from the request context, because a composition that omits them must skip them rather than fail; the root keeps `NotificationService` and `PostEmbeddingService` in the route context for that reason.

The Public API is the first surface converted. The widget, the dashboard's `HttpRoute`, and the RPC groups move as work touches them, not in a sweep.

Its scope vocabulary moves to `@feeblo/domain-contracts/src/public-api-scope.ts`, the home ADR 0002 gives client-visible vocabulary, and the old path is deleted rather than shimmed because every call site moved in one commit.

**The Public API does not get its own package.** The trigger for revisiting is below.

## Why

The composition was assembled twice and had already drifted. `makeServiceLayers` chained five `Layer.provide`s onto `PublicApiRepository.layer`; `api-live.test.ts` had a `makePublicApiDependencies` chaining four of the same five onto the same layer. The test's copy was missing the `NotificationService` line. Neither file said which list was authoritative, and a new private dependency meant editing both — which is the actual cost this decision removes. It is not a principle-looking-for-a-problem: the drift existed, in the one surface with the most churn.

**What a package would have bought, and what it would not.** Extraction is mechanically easy — every internal the surface reads is already a public export — but the package would import `@feeblo/domain` for ten live modules: `asset/service`, `changelog/publication`, `post-activity/repository`, `tag/post-tag-activities`, `services/s3`, `email-outbox/workflow`, `entitlement/policies`, `rate-limit/service`, `auth-handler`, and `rpc-errors`. The boundary would read "the Public API package reads the domain's internals", which is the opposite of what a package is usually bought for. It would buy nothing at the gate either: `turbo.json` records per-package lint tasks measured at ~6× the wall time of the single whole-repo task, because the type-aware pass builds one TypeScript program. And nothing is published from it — the published SDKs are the widget's iframe SDK, not a REST client — so there is no version boundary to gain.

Extraction becomes the right answer when either of these is true, and not before:

1. The surface needs a dependency the `domain` package must not carry: another runtime, a provider package, an edge deployment.
2. A second app serves `/api/v1` without the dashboard.

Until one of them is true, a private package whose dependencies point back into `domain` is a directory with more ceremony.

## Consequences

Adding a private dependency to a surface is now one edit in one file, and the surface's tests assemble the same shape as production while substituting only the layers they must.

`PublicApiRepository.layer` is `provideMerge`d rather than provided, because a test drives the repository directly to reach races the HTTP surface cannot produce. It stays in the route layer's output for that reason.

The requirement channel is only as honest as its declarations. When this decision was written, a service read through `Context.getUnsafe` — `currentPublicApiConfig`, `currentPublicApiRepository` — appeared in no layer's type, so **removing the line that provides it compiled**. It died at request time instead, and the surface's own tests could not catch it because they supply their own. `PublicApiConfig` was exactly this: two handlers read it to build a post's `url`, and the only thing that noticed its absence was the Playwright job, because `getPost` happens to read the same service and the spec calls it.

The Public API no longer reads collaborators that way. Each operation declares its requirements, `PublicApiDependencies` (`public-api/operations.ts`) is the union of those declarations minus the key middleware's request-scoped caller, and `api-live.ts` yields that context while building each group — the same "yield a stable capability and close over it" shape the dashboard's handlers use. A missing provider is therefore a compile error in the route's own type, and the root no longer carries a warning about a service no type names. The MCP toolkit (`mcp.ts`) captures the same context when its layer is built and erases only `PublicApiCaller`, which the key middleware provides per request.

Two `workspace:*` dependencies follow from the scopes move: `@feeblo/auth` and `@feeblo/web` now depend on `@feeblo/domain-contracts` directly, instead of reaching the vocabulary through the Public API's server module. That direction is the one ADR 0002 already prescribes.

The write path's required environment is now a compile-time obligation: a collaborator missing from `PostWriteService.layer` fails the composition root's build rather than one request. Its optional fan-outs are the part the type system cannot enforce — they are read from the request context, so the root must keep them there.

That gap is now visible to `pnpm test`: `apps/server/src/app/program.test.ts` builds the same `makeServerApp` production launches, over a PGlite database and the test configs the Public API harness proves, with `NodeHttpServer.layerTest` in place of the bound port. A missing provider or a layer whose build fails now fails the suite instead of one request.
