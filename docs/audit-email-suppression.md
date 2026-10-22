# Email deliverability and suppression audit

Audit date: 2026-10-22. Scope: `packages/transactional`, `packages/domain/src/email-outbox`, `packages/domain/src/email-provider-feedback`, `packages/domain/src/email-subscription`, `packages/auth`, and the `email_suppression` table.

The decision record for the scoping change is [`docs/adr/0022`](./adr/0022-suppression-is-scoped-to-the-sender.md).

## Verdict

The outbox was already a strong _event pipeline_: a provider event ledger with idempotency, SNS signature and topic verification, a signed token gate and a rate limiter on ingress, and delivery transitions guarded by a state machine. The suppression list wrapped around it was the weak part: one global row per address, written by two divergent code paths, with no management surface, no correlation fallback, and no coverage for the mail that does not go through the outbox.

Most findings below are fixed in this branch. Two are documented follow-ups because they need a dependency decision (`pnpm` catalog) or a UI build.

## Findings

### P0 — correctness

| # | Finding | Status |
| --- | --- | --- |
| 1 | A synchronous recipient rejection (`550 5.1.1`) marked the delivery `failed` and never suppressed the address. The webhook would have reported the same fact later; the SMTP reply already carries it. | Fixed |
| 2 | A hard bounce or complaint whose Message-ID could not be matched was dropped, _including the suppression_. Header truncation, a rewritten Message-ID, or mail outside the outbox all hit this. | Fixed |
| 3 | Auth mail (password reset, invitation, OTP) and the onboarding workflow bypassed the suppression list entirely; they also never created a delivery row, so their bounces could never correlate. | Fixed |
| 4 | `Undetermined` SES bounces were treated as permanent address facts and suppressed forever. AWS means "SES could not classify this". | Fixed |

### P1 — policy and data

| # | Finding | Status |
| --- | --- | --- |
| 5 | Suppression was global, so one workspace's complaint silenced every workspace's mail, including mail about the recipient's own account. | Fixed — workspace-scoped, see ADR 0022 |
| 6 | `administrative_block` had no writer, and there was no list/add/remove/stats surface. An appeal could only be answered with SQL. | Fixed — four RPCs under `emailSuppressions.manage` |
| 7 | `EmailSubscriptionRepository.upsertSuppression` duplicated the feedback service's write with a different conflict policy, and its non-null-event branch raised a unique violation for a known address. It was reachable only from tests. | Fixed — removed; one writer |
| 8 | The latest event overwrote the reason, so a complaint erased the hard-bounce record. | Fixed — reason precedence plus `first_reason` |
| 9 | Suppression rows were the only email PII with no tenant and no deletion path; a workspace deletion left raw addresses behind. | Fixed for workspace rows (FK cascade); platform rows are documented retention |
| 10 | A suppressed address could still ask for a changelog subscription and be told `verificationRequired: true`; the verification mail was then suppressed and the row sat pending forever. | Fixed — no verification intent is recorded and the response is the already-subscribed shape; the row is kept so a later request, after the suppression is lifted, re-issues a token |
| 11 | Soft bounces were terminal, so a full mailbox ended the delivery. | Fixed — deferred with a six-hour backoff, bounded by the attempt budget |

### P2 — hardening and observability

| # | Finding | Status |
| --- | --- | --- |
| 12 | No bounce, complaint, or suppression metrics; `state: "bounced"` did not distinguish hard from soft. | Fixed — labelled counters in `email-suppression/telemetry.ts` |
| 13 | Case-insensitivity was convention only: both writers normalized, but the primary key and the lookup were case-sensitive. | Fixed — `CHECK (email = lower(btrim(email)))` and normalized lookups |
| 14 | Suppressed member deliveries were materialized, then skipped at send time, after the plan and volume queries. | Fixed — the check runs first; members are filtered at materialization |
| 15 | The suppression `SELECT` and the materialization `leftJoin` were the only consumers, so an auth-path check would have needed a third copy. | Fixed — one `EmailSuppressionRepository` shared by the queue, feedback, subscriptions, auth, and the RPCs |
| 16 | The `Message-ID` domain was hardcoded and no direct send supplied one, so nodemailer fell back to a host-derived identifier. | Partly fixed — direct sends now get one on `MESSAGE_ID_DOMAIN`; deriving the domain from the From address remains a follow-up |
| 17 | Removing a local suppression does not remove the SES account-level suppression entry, so SES can still drop the mail. | Documented follow-up (needs the AWS SDK, a catalog change) |

## The model after this change

`email_suppression` has two scopes, enforced by partial unique indexes:

- **Workspace row** (`organization_id` set): a bounce, complaint, or manual block observed by that workspace. It silences that workspace's mail.
- **Platform row** (`organization_id` null): a hard bounce of mail that belongs to no workspace (verification, password reset, onboarding) or of a delivery that could not be attributed. It applies to every sender.

Reasons are ranked: `complaint` (3) > `administrative_block` (2) > `hard_bounce` (1). A later event can strengthen a row but never weaken it, and `first_reason` keeps the original cause. A manual `note` survives a provider event that carries none.

The send path consults the list before the circuit breaker, the monthly volume queries, and the consent gate, and again on every retry. A failure to read the list fails the attempt (and defers it) rather than sending blind.

### What suppresses now

- **Provider hard bounce** with a correlated delivery → workspace row.
- **Provider hard bounce without a correlated delivery** → platform row. The address is still a fact; this is what covers account mail and correlation failures.
- **Provider complaint** with a correlated delivery → workspace row.
- **Provider complaint without a correlated delivery** → logged, not suppressed: a complaint is about a sender, and there is no sender to scope.
- **SMTP recipient rejection** at submission → workspace row. The transport classifies `5.1.x`, `5.2.1`, `551`, and `553` as recipient facts. It does _not_ suppress `5.7.x` (policy), `5.6.x`/`5.2.3` (content), `5.3.x`, or `552` (size), and it treats `5.2.2` (mailbox full) as a temporary failure.
- **Manual block** through `AddEmailSuppression`.

### What does not suppress

- **Soft bounce** and **undetermined bounce**: the delivery is deferred for six hours, up to the five-attempt budget, then failed. Neither writes a row.
- **SES `Transient`/`Undetermined`** or a bounce of a delivered message.
- **Provider `deferred`/`DeliveryDelay`**: observable only. The provider is still attempting delivery; Feeblo must not send a second copy.

## Operational notes

- **Platform rows** are not visible to a tenant and cannot be removed by one. They are the abuse-prevention record for account mail. Lift one only through an operator action backed by evidence; the row is the only reason the auth path stops retrying a dead address.
- **A workspace removing its own row** does not unblock the address for another workspace, and it does not remove a SES account-level entry.
- **SES parity**: when `SMTP_HOST` is SES, SES also maintains an account-level suppression list. Removing a Feeblo row does not remove that entry. Until a provider seam exists, the runbook step is to remove the address from the SES account suppression list in the sending region as well. Adding the SDK is a catalog change and needs sign-off; do not bolt a raw HTTP client into the domain for it.
- **Correlation**: the webhook matches `Message-ID` first (normalized to angle brackets) and `X-Feeblo-Delivery-Id` second. Every outbox message carries the second header. Direct sends (auth, onboarding) do not have a delivery row, so their bounces are attributed by recipient and land in the platform scope.

## Follow-ups

1. **SES account-level suppression parity** — add `EmailSuppressionProvider` with `add`/`remove`/`status`, implemented for SES, once the dependency is approved. Until then, document the manual step (above).
2. **Message-ID domain derived from the From address** — `MESSAGE_ID_DOMAIN` is still `notifications.feeblo.com`. A self-hosted deployment should be able to align it with its sending domain without also changing the value persisted in `email_delivery.message_id` for in-flight rows.
3. **Dashboard UI** — the RPC surface exists; no settings page consumes it yet. `docs/permissions.md` records `emailSuppressions.manage`.
4. **Bounce and complaint _rate_ alerts** — the counters exist, but no alert rule consumes them. AWS warns at 5% bounce / 0.1% complaint and can suspend sending at 10% / 0.5%; a Grafana rule over the new counters is the next step.
5. **Spam-complaint feedback loop for non-SES providers** — the pipeline is provider-neutral internally but the only ingress is SNS. A second ingress would need its own signature verification, not a shared token.

## Tests

Added or updated:

- `email-provider-feedback/service.test.ts` — uncorrelated hard bounce suppression, uncorrelated complaint refusal, delivery-id correlation, soft and undetermined deferral, attempt-budget exhaustion, reason precedence, workspace scoping, platform rows.
- `email-provider-feedback/ses-mapping.test.ts` — recipient extraction with the account-suppression-list fallback, delivery-id header, undetermined mapping, Message-ID normalization.
- `email-suppression/repository.test.ts` — scope isolation, precedence, idempotency, search/list/stats, removal, cascade on workspace deletion.
- `email-suppression/handlers.test.ts` — admin gate, manager denial, tenant isolation, removal of a foreign row.
- `email-suppression/guard.test.ts` — platform-only auth-mail gate.
- `email-outbox/queue.test.ts` — SMTP recipient rejection suppression, delivery header, suppressed member not materialized.
- `email-subscription/handlers.test.ts` — a suppressed address is not promised a verification email.
- `transactional/src/mailer.test.ts` — 5xx classification, generated Message-ID.
