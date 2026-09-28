# ADR 0006: A surface owns its composition

## Decision

An API surface in `packages/domain` defines its own composition, in its own module, and draws one line through its dependencies:

- **Private layers are closed over.** The layers only that surface reads are merged into a bundle the surface provides to itself. The Public API's is `PublicApiInternals` in `packages/domain/src/public-api/router.ts`: the email outbox, the notification fan-out, and the post-activity repository — the write-path side effects it performs, which no other surface reads through it.
- **Shared layers stay requirements.** Everything the surface shares with the rest of the server remains in its layer type: the database, `Auth`, the rate limiter, the plan decision, media storage, and the surface's own config. The composition root supplies the real service; a test supplies its substitute (`S3Test`, a smaller rate-limit budget, `PublicApiConfig.layerTest`). Neither restates the surface's private wiring.

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

The requirement channel is only as honest as its declarations. A service read through `Context.getUnsafe` — `currentPublicApiConfig`, `currentPublicApiRepository` — appears in no layer's type, so **removing the line that provides it compiles**. It dies at request time instead, and the surface's own tests cannot catch it because they supply their own. `PublicApiConfig` is exactly this: two handlers read it to build a post's `url`, and the only thing that notices its absence is the Playwright job, because `getPost` happens to read the same service and the spec calls it. The endpoint that actually puts `config.appUrl` into a response — `listBoardPosts`'s paging link — is not covered. That safety net is a coincidence of coverage rather than a designed one, so the root's assembly line carries the warning as well.

Two `workspace:*` dependencies follow from the scopes move: `@feeblo/auth` and `@feeblo/web` now depend on `@feeblo/domain-contracts` directly, instead of reaching the vocabulary through the Public API's server module. That direction is the one ADR 0002 already prescribes.
