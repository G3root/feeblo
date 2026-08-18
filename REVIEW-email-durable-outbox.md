# Code Review: `email-durable-outbox`

- **Branch:** `email-durable-outbox`
- **Base:** `origin/main` (merge-base `c17552df82fe3f9e45ae21ba5b36ec1c225cca1c`)
- **Commits (5):** `a8c49d8` Update application features and supporting components · `eefc8d4` fix: address email outbox review findings · `669bbfc` Centralize delivery transitions and preserve unsubscribed subscriptions · `f118bc5` Refine post handler test fixtures · `7ba88e3` chore: compact migrations
- **Diff:** 53 files, ~19.6k insertions
- **Spec source:** `plan.md` (added in this branch, 507 lines)
- **Standards sources:** `~/.agents/skills/coding-standards` (no repo `CODING_STANDARDS.md`), Fowler smell baseline, repo conventions in changed area

---

## Standards

**Sources:** user coding-standards skill, smell baseline, repo conventions. Tooling-enforced items (types, lint) skipped — typecheck passes for `@feeblo/domain`, `@feeblo/transactional`, `@feeblo/db`.

**Compliance is strong:** data decoded at boundaries (repository `decode*` + schema checks in `email-subscription/schema.ts`), typed `TaggedErrorClass` failures everywhere, services as Effect `Context.Service`, tokens `Redacted` and hashed at rest (`tokens.ts`), no PII/body logging (`telemetry.ts`), tests through real PGlite interfaces, state machine centralized (`delivery-state.ts`), guarded SQL transitions for concurrency.

### Judgement calls (smells)

- **Duplicated Code** — `wakeEmailOutboxBestEffort` is copy-pasted in `changelog/handlers.ts` and `post/handlers.ts`; the `recordIntent → mapError(InternalServerError)` block repeats ~5× across those two files. Extract one helper.
- **Dead code / Speculative Generality** — `post.official_update_published` (`schema.ts:12`) has no recorder anywhere; `workflow.ts:259` hardcodes `markIntentState("failed")` for it, a branch no real flow can reach. Also `releaseSendingDelivery`/`markDeliveryDeferred` aliases (`repository.ts`) and `const intents = pending` (`workflow.ts`) add nothing.
- **Duplicated logic shape** — `normalizeRecipientEmail` (`email-outbox/repository.ts`) reimplements `normalizeEmailAddress` (`email-subscription/schema.ts`); two distinct payload builders for submission vs subscription content (`workflow.ts`) with inconsistent shapes.
- **Feature Envy (mild, deliberate)** — `materializeSubmission` in the workflow holds recipient-resolution policy (owner/admin fan-out, subscription join). Functional-core trade-off, acceptable; the code comments acknowledge the interim state.
- **Inconsistent story in comments** — `workflow.ts:226` says one-click unsubscribe "lands in a later slice," yet the public token RPCs for it already ship in this branch; the comment at `handlers.ts:83` claims the token "is returned to the caller responsible for creating its future verification-email outbox intent" — no such caller exists (see Spec).

No hard documented-standard violations found.

---

## Spec

**Source:** `plan.md`. This branch implements slices 1–5 and 8–9 substantially, plus parts of 7, 10, 11, 12 — with several plan requirements missing or incomplete.

### Missing / broken

1. **Double opt-in cannot complete for external subscribers.** Plan: "The subscriber must verify the email address through double opt-in" and slice 7 "Verification tokens, double opt-in…". The token is generated, hashed, returned to the RPC adapter — which deliberately discards it (`handlers.ts:153`, `rpcs.ts:16` "responses never include link tokens"). Nothing sends the verification email; no outbox intent kind exists for it. A changelog subscriber is stuck `pending_verification` forever. This is the plan's central consent flow and it's dead-ended.
2. **No one-click unsubscribe in emails.** Plan: "Every subscription email includes a one-click unsubscribe mechanism" and "list-unsubscribe headers". Emails carry `unsubscribeUrl: …/settings/notifications` (a placeholder, acknowledged in comments); the workflow test _asserts_ `List-Unsubscribe` headers are absent — directly contradicting the plan.
3. **`post.official_update_published` unimplemented.** Plan: "Official post updates, merges, and closures send immediately" (slice 10). Merges/closures/status-coalescing work; official updates are a schema-only stub that the workflow hard-fails.
4. **Provider feedback not wired.** Plan: "Cloudflare lifecycle event ingestion …" — `EmailProviderFeedbackService` + tests exist but no HTTP/queue consumer registers it; no route references it.
5. **Configured free recipient / admin opt-in absent.** Plan: "Free workspaces receive new-submission notifications at one _configurable_ email address"; paid fan-out is to "opted-in administrators". Code uses owner/admin roles with a `slice(0, limit)` (`workflow.ts:307-316`), acknowledged as temporary.
6. **Guardrails mostly missing (slice 12).** Only the verification rate limit exists (3/24h per org+address; plan asked per _IP_, address, and workspace). No circuit breakers, spend/volume controls, concurrent-send limits, or cost metric.
7. **Status dedup key deviates.** Plan: the key "should identify the post's open coalescing window"; code embeds `now.getTime()` (`post/handlers.ts:281`). The partial unique index `email_outbox_pendingStatusAggregate_uidx` compensates, so behavior is right, but a retried status change after window close can re-send.

### Implemented well

- Atomic intent+product transactions with post-commit wake + hourly reconciliation
- Per-recipient retries with bounded jittered backoff
- Deterministic message IDs
- Plan recheck at materialization _and_ delivery
- Downgrade pause / 7-day expiry / upgrade resume (covered by tests)
- First-publish-only changelog sends
- Creator auto-subscribe and removal of comment/upvote auto-subscribe
- Suppression vs unsubscribe separation
- Token hashing/TTL
- Idempotent public endpoints

### Verification

- All new email tests pass: 74 domain tests (`email-outbox`, `email-subscription`, `email-provider-feedback`, `changelog`, `entitlement/email-policies`, `post-subscription`) + 5 transactional (`mailer.test.ts`)
- One failing test (`widget/api-live.test.ts`) reproduced on `origin/main` — pre-existing, not a regression

---

## Summary

- **Standards:** 0 hard violations, 4–5 judgement calls — worst: dead `official_update_published` branch and duplicated wake/record blocks.
- **Spec:** 7 gaps — worst: double opt-in verification email is never sent, leaving the changelog subscription flow functionally incomplete.
