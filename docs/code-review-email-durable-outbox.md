# Code Review — `email-durable-outbox`

- **Fixed point:** `main` (merge-base `6012f2c`)
- **Branch:** `email-durable-outbox` (5 commits: `a8c49d8`, `eefc8d4`, `669bbfc`, `f118bc5`, `7ba88e3`)
- **Diff:** `git diff main...HEAD` — 53 files, ~19.6k insertions
- **Spec source:** `plan.md` ("Email Outbox Architecture Plan")
- **Standards sources:** user `coding-standards` skill + references; repo skills (`effect`, `effect-use-pattern`, `quality-code`, `wrdn-effect-*`); Fowler smell baseline. No repo-level `CODING_STANDARDS.md`/`AGENTS.md` exists.
- **Method:** two parallel sub-agents (Standards / Spec), run via Herdr panes.

## Standards

**Reviewed against:** user `coding-standards` skill + references (errors, workflows/idempotency, persistence, domain-types, testing, typescript-safety, sensitive-data) · repo skills (effect, effect-use-pattern, quality-code, wrdn-effect-*) · Fowler smell baseline.

### Documented-standard concerns (judgement calls, mostly deliberate)

1. `email-outbox/workflow.ts` — `sendDeliveryAttempt` has an untyped error channel: `Effect.Effect<DeliveryAttemptOutcome, unknown, …>`. errors.md requires every known failure mode in the return type as a tagged error. Worse, the dispatcher activity's `mapError` flattens all failures to one generic `EmailOutboxDataError({ reason: "Could not process email delivery" })`, discarding the repository's granular operation/reason (e.g. "Stored email delivery record is invalid"). Error classification by tags/fields (errors.md) is lost; diagnostics regress to message text.
2. `email-subscription/repository.ts` — `requestSubscription` input: `alreadyVerifiedUser?: { userId }` + `userId?: string` are two overlapping optionals whose consistency is only a runtime check ("Verified user evidence must match…"). domain-types-and-state: behavior-controlling flags become named options/domain values; this pair wants to be a single union (`{ verified: { userId } } | { unverified: … }`). `post-subscription/handlers.ts` is forced to pass both redundantly.
3. `post-subscription/handlers.ts` — non-atomic dual writes: legacy `repository.subscribe` then `emailSubscriptions.requestSubscription` are separate writes in the same datastore, no transaction. workflows-transactions-and-idempotency: one datastore → commit/roll back together. A failure after the first write leaves the legacy subscription committed while the RPC 500s. Also `mapError(() => new InternalServerError(...))` collapses every granular error — classification lost.
4. `email-subscription/handlers.ts` — input errors surface as 500: `EmailSubscriptionInputError` → `internalConsentFailure` → `InternalServerError`, although the repo has a `BadRequestError` convention (used in `post/handlers.ts`). A client-supplied invalid email should be a 4xx at the outermost boundary (errors.md).

### Baseline smells (judgement calls)

- **Duplicated Code** — the "record outbox intent → map to InternalServerError → check Inserted → wakeEmailOutboxBestEffort" shape recurs ~5×: `changelog/handlers.ts` (create, update, SendUpdate) and `post/handlers.ts` (create, status update, merge). Extract one `recordIntentAndWake` helper. The 7-day TTL is spelled two ways: `7 * 24 * 60 * 60 * 1000` (changelog) vs `7 * 86_400_000` (post), plus a bare `300_000` 5-minute delay; `86_400_000` also duplicates `email-subscription`'s `VERIFICATION_TOKEN_TTL_MS`.
- **Dead code from the migration (Shotgun Surgery residue)** — `post/workflow.ts` (`SubmissionEmailNotificationWorkflow`, `scheduleSubmissionNotificationBatch`) and `post/repository.ts:915` `scheduleSubmissionNotification` are no longer referenced by any handler or layer (`workflows.ts` dropped the layer); only `post/workflow.test.ts` keeps them alive. The deletion test says remove them.
- **Divergent Change (minor)** — delivery transitions are centralized in `delivery-state.ts` (good), but intent-state guards are hand-inlined in `repository.markIntentState`; two state machines with inconsistent centralization.

### Notable strengths

Transactional outbox records intents atomically with domain writes; stored rows parsed at the edge; tokens hashed/redacted per sensitive-data; tests use real PGlite + TestClock + recording TestMailer (no module mocks); granular tagged errors (`EmailOutboxDataError`, `Mail*DeliveryError`) with stable operation/reason fields.

## Spec

**Spec source:** `plan.md` ("Email Outbox Architecture Plan", 507 lines).

### (a) Missing / partial requirements

1. **Official post updates.** Spec: "Official post updates, merges, and closures send immediately." No handler ever records `post.official_update_published` (grep: only schema + workflow.ts), and the dispatcher actively fails such intents (workflow.ts:259). `PostAdminUpdate` (post/handlers.ts) emits no intent at all.
2. **Double opt-in is not end-to-end.** Spec: "The subscriber must verify the email address through double opt-in." `requestChangelogSubscription` returns a Redacted token "for the caller responsible for creating its future verification-email outbox intent" (handlers.ts comment), but the RPC strips it (`EmailSubscriptionRequestAccepted`), no intent kind for verification email exists, and nothing in apps/ consumes these RPCs. No verification email can ever be sent.
3. **One-click unsubscribe absent from emails.** Spec: "Every subscription email includes a one-click unsubscribe mechanism" and "both a visible unsubscribe link and appropriate list-unsubscribe headers." Emails point to `${appUrl}/settings/notifications` (workflow.ts, acknowledged workaround), and workflow.test.ts:382 asserts List-Unsubscribe headers are undefined. The public token endpoint exists but no email links to it.
4. **Explicit post subscriptions.** Spec: "Other users must explicitly choose to subscribe." Only `EmailSubscriptionChangelogSubscribePublic` exists; there is no post-subscribe RPC.
5. **Free recipient / admin opt-in.** Spec: "Free workspaces receive new-submission notifications at one configurable email address" and "Paid workspaces may notify every opted-in administrator." Implementation hardcodes owner (free) and all owner+admin members (paid); no configurable address or opt-in storage (workflow.ts comment concedes this).
6. **Cost controls.** Spec: "Submission-notification circuit breakers per workspace. Global provider spend and volume circuit breakers. Limits on concurrent sends. Alerts…" — none present. Verification rate limit (spec: "per IP, address, and workspace") keys only on `organizationId:email` (email-subscription/handlers.ts).
7. **Cloudflare event ingestion is dead code:** `EmailProviderFeedbackService` has no HTTP endpoint or queue consumer wired in apps/.
8. **Metrics partial:** spec wants sends by plan, retry counts, oldest-queued age, monthly cost; telemetry.ts emits three counters only.

### (b) Scope creep

- `complained` lifecycle event and `email_provider_event` ledger beyond the four configured event types (spec: "Delivered, Deferred, Bounced, Failed"); complaint suppression is defensible, the event type is extra.
- Otherwise scope is contained.

### (c) Implemented but wrong

- `post.official_update_published` intents are deliberately marked failed at materialization (workflow.ts:259) — the only implementation of this kind is a dead-end.
- Status coalescing dedup key is `post.status_changed:{org}:{postId}:{now.getTime()}` (post/handlers.ts), not "the post's open coalescing window" as the spec requires; coalescing works only incidentally via the partial unique index `email_outbox_pendingStatusAggregate_uidx`.
- Unsubscribe is unreachable from mail while being the only idempotent endpoint — the two halves of the spec's unsubscribe requirement don't connect.

## Summary

- **Standards:** 7 findings (4 documented-standard concerns + 3 baseline smells). Worst within axis: the untyped `unknown` error channel in `sendDeliveryAttempt` with `mapError` flattening that destroys error classification.
- **Spec:** 12 findings (8 missing/partial + 1 scope-creep + 3 implemented-wrong). Worst within axis: double opt-in is not end-to-end (no verification-email intent kind, RPC strips the token, nothing consumes it — the verification email can never be sent).
