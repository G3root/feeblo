# Plan: Industry-standard email notification architecture

Status: **Implemented — all phases shipped** (2026-08-08). Phase 1
(generalized outbox + durable workflow), Phase 2 (batched dispatcher +
per-recipient delivery records), Phase 3 (stateless unsubscribe tokens +
suppression list + webhook ingestion + admin surface), Phase 4 (daily
per-recipient cap with hold-and-recycle; windowed per-post digests; provider
send budget via the shared RateLimiter; per-workspace daily quota wired to
plan entitlements), and Phase 5 (health endpoint with SMTP/last-send/failure
state + Sentry-captured alerting; admin dashboard with per-template volume,
success/error split, digest-vs-instant split, suppressed list, dead letters,
and per-post triage) are implemented for the `post_status_changed` kind, with
tests in `packages/domain/src/email/workflow.test.ts`,
`packages/domain/src/email/delivery.test.ts`, and
`packages/domain/src/post/handlers.test.ts`. Status/kind/reason columns are
plain text typed from Effect Schema vocabulary (no Postgres enums). In-app
notifications remain out of scope (documented in `docs/notifications.md` and
working as designed).

## 1. Current state (ground truth — verify each point before changing code)

### How email is sent today

- `Mailer` is an Effect service in `packages/transactional/src/mailer.ts` —
  Nodemailer SMTP transport, React Email templates rendered at send time
  (`render`, `toPlainText`). Errors are typed via `Schema.TaggedErrorClass`
  (`MailTemplateRenderError`, `MailDeliveryError`). Config is env-driven through
  `MailerConfig` in `packages/transactional/src/config.ts` (`SMTP_HOST`,
  `SMTP_PORT`, `SMTP_FROM_ADDRESS`, … read via the `@feeblo/config/effect`
  `optionalString`/`optionalInteger` helpers, password as `Config.redacted`).
- Templates live in `packages/transactional/src/templates/` (`notification.tsx`,
  `user-onboarding.tsx`, `user-feedback.tsx`, `password-reset.tsx`,
  `verification-otp.tsx`, `organization-invitation.tsx`, `weekly-digest.tsx`,
  plus `email-shell.tsx`/`theme.ts`/`fonts.tsx`). `weekly-digest.tsx` already
  exports the shared `EmailPostList` block used by `notification.tsx`, but its
  `WeeklyDigest` component itself is currently unused — a starting point for
  Phase 4 digests.

### Email is already asynchronous and durable — via Effect durable workflows

The plan's older assumption ("send sites call `mailer.send(...)` synchronously in
the request path") is **wrong**. All notification-style emails run inside durable
workflows from `effect/unstable/workflow`, executed by an in-process workflow
engine:

- `SubmissionEmailNotificationWorkflow` (`packages/domain/src/post/workflow.ts`):
  a 15-minute cooldown (`W.DurableClock.sleep`) followed by one
  `W.Activity.make` that sends a "new submission(s)" notification email to every
  workspace member (`concurrency: 5`, per-recipient `messageId`
  `<submission.${batchId}.${encodeURIComponent(to)}@notifications.feeblo>`),
  retried via `W.Activity.retry({ times: 3 })` (4 total attempts — asserted in
  `post/workflow.test.ts`). Success path deletes the delivered queue rows and
  releases the batch in one `transaction(...)`, then **re-schedules itself**
  (`scheduleSubmissionNotificationBatch`) to drain any posts queued during the
  cooldown. `idempotencyKey: ({ batchId }) => batchId` prevents duplicate
  executions. DB errors are wrapped as `SubmissionNotificationDataError`.
- `WelcomeUserWorkflow` (`packages/domain/src/user/workflows.ts`): durable sleeps
  of 2 hours (onboarding email) and 6 days (feedback-request email), each an
  `W.Activity.make` with `idempotencyKey` = `userId`. Triggered from the auth
  flow in `packages/auth/src/server.ts` (`afterEmailVerification` →
  `scheduleWelcome`, executed via a `ManagedRuntime` callback runtime with
  `{ discard: true }`; failures are logged, never surfaced to the user).
- Workflow layers are composed in `packages/domain/src/workflows.ts`:
  `Layer.mergeAll(WelcomeUserWorkflowLayer, SubmissionEmailNotificationWorkflowLayer)`
  provided with `Mailer.layer`, then merged with `ClusterWorkflowEngine.layer` +
  `SingleRunner.layer()` (live) or `TestRunner.layer` (test). `apps/server/src/
  index.ts` is still the single process entrypoint: the engine runs **in-process
  as a fiber inside the server**, backed by Postgres (`SingleRunner`'s default
  SQL `MessageStorage`/`RunnerStorage` — hence the live path provides
  `Database.SqlClientContextLive`). Workflow execution is therefore durable
  across process restarts; no separate worker binary exists.

### A specialized outbox already exists for submission emails

This is the reference pattern Phase 1 generalizes:

- `submission_notification_queue` (`packages/db/src/schema/feedback.ts`):
  `postId` PK, `organizationId`, `created_at` — written **inside the source
  mutation's DB transaction** via `repository.enqueueSubmissionNotification`
  in `createPostEffect` (`packages/domain/src/post/handlers.ts`).
- `submission_notification_batch`: `id` PK, `organizationId` **unique** —
  the unique org column + `onConflictDoNothing` is the claim/dedupe lock
  (only one cooldown batch per workspace at a time; concurrent schedulers
  collapse onto the same batch row — tested in `post/workflow.test.ts`).
- After the transaction commits, `PostRepository.scheduleSubmissionNotification`
  (`packages/domain/src/post/repository.ts`) resolves the engine via
  `Effect.serviceOption(WorkflowEngine)` and schedules the workflow. Scheduling
  is **best-effort**: if it fails, only a warning is logged and the durable queue
  rows stay behind — the next mutation's schedule call drains them. No outbox
  write → no mutation commit; queue rows are never lost.

### Auth emails (OTP / password reset / invitation)

`packages/auth/src/server.ts` sends these through Better Auth callbacks
(`sendVerificationOTP`, `sendResetPassword`, `sendInvitationEmail`) using the
same `callbackRuntime` + `Mailer.use(...)`. OTP sends are rate-limited
(`RateLimitService.consumeVerificationOtpRateLimitForFlow`). These are
transactional/auth emails — Phase 1's outbox does not need to absorb them, but
they must keep working (see Constraints).

### What is genuinely missing

- No per-recipient delivery record (`email_deliveries`), so no way to answer
  "did member X get the email about post Y?" and no crash-restart dedupe beyond
  workflow idempotency keys.
- No suppression list, no bounce/complaint ingestion (SMTP-only; Nodemailer's
  `sendMail` either resolves or rejects — no provider webhooks today).
- No stateless unsubscribe tokens (the submission email links to
  `/settings/notifications`).
- No frequency caps or provider rate limiting beyond the 15-minute submission
  cooldown; per-recipient email count is unbounded (e.g. N comments in 10
  minutes → N emails, each workflow run one email per member).
- `docs/notifications.md` already anticipates this work: "if Feeblo later
  exposes webhooks to customers, introduce a transactional outbox and retrying
  signed dispatcher as a separate integration boundary."

## 2. Goal architecture

```
mutation ──(same tx)──> outbox/queue rows ──> schedule durable workflow (best-effort)
                                                        │
                             ClusterWorkflowEngine + SingleRunner (in-process, SQL-backed)
                                                        │
                                                        ▼
                                   per-kind workflow: cooldown/digest → activity
                                                        │
                                                        ▼
                                   per-user frequency caps (RateLimiter, fixed-window)
                                   + suppression list + provider rate limiting
                                                        │
                                                        ▼
                                         Mailer (SMTP, existing service)
                                         webhooks → bounce/complaint → suppression
                                                             (when provider supports it)
```

The user's write action never does email work itself — it appends queue/outbox
rows in the same DB transaction, returns, and (best-effort) schedules a durable
workflow. Delivery is constant-time regardless of recipient count. This is
exactly the shape the submission-email flow already has; the plan generalizes it
and adds delivery tracking, suppression, caps, and observability.

## 3. Non-goals

- No changes to in-app notifications (`NotificationService`, RPCs, dashboard
  polling) — see `docs/notifications.md`.
- No replacement of the `Mailer` service, its SMTP config, or the durable
  workflow engine. Resend/Postmark API support is only added if a phase
  explicitly calls for it and the decision is justified.
- No change to existing preference semantics (per-post subscribe, mute-all).
  Delivery *how* changes, not the user-facing model.
- No message broker. The durable workflow engine (Postgres-backed) replaces one
  at this scale; queue rows + idempotency keys are the durability story.

## 4. Phases (in order; each independently shippable, each ends green)

### Phase 1 — Generalize the transactional outbox + durable workflow pattern

**Problem:** the submission flow's outbox is specialized (one table pair, one
workflow). Other notification emails (comment, status change) either don't exist
or would duplicate the plumbing; nothing generic records "an email-worthy event
happened, durably, in the same transaction as the mutation".

**Already exists (reuse, don't rebuild):** the queue-inside-transaction pattern
(`createPostEffect` + `enqueueSubmissionNotification`), the batch claim lock
(unique `organizationId` + `onConflictDoNothing`), the durable workflow skeleton
(`SubmissionEmailNotificationWorkflow`), activity retry (`W.Activity.retry`),
idempotency keys, best-effort scheduling via `Effect.serviceOption(WorkflowEngine)`,
and the in-process engine wiring (`apps/server/src/index.ts`).

1. **`email_events` table** (via `@feeblo/db` schema + `db-migrator` migration):
   `id`, `kind` (feedback_submitted | feedback_commented | status_changed | …),
   `payload` JSONB, `status` (pending | processing | sent | failed), `attempts`,
   `available_at`, `created_at`, `processed_at`, `last_error`. The payload must
   be **self-contained** (post id, title, URL, actor, comment id, status change,
   recipient resolution inputs) so no send-time lookups are needed and later
   edits/deletes can't corrupt delivery.
2. **Enqueue helper** (`EmailOutboxService` in a new `packages/domain/src/email/`
   subpackage): `enqueue(tx, kind, payload)` called **inside the same
   `transaction(...)`** as the source mutation — mirror `NotificationService`
   (which joins the fiber-local tx via `currentDb` from `packages/db/src/
   database.ts`). No outbox write → no mutation commit.
3. **Per-kind workflows** mirroring `SubmissionEmailNotificationWorkflow`:
   one `W.Workflow.make` per kind (or one parameterized workflow with a
   dispatcher activity — decide in implementation), `idempotencyKey` derived
   from the outbox row id, `W.Activity.retry({ times: 3 })` (or configurable),
   `Effect.annotateLogsScoped({ kind, eventId, organizationId })`.
4. **Claim/dedupe**: reuse the batch-table idiom — a claim row whose unique key
   collapses concurrent schedules — or rely on the workflow idempotency key
   alone. No `FOR UPDATE SKIP LOCKED` sweeper is needed; the engine is the
   scheduler. Keep `scheduleSubmissionNotification`'s best-effort, logged
   scheduling.
5. **Reaper gap to close**: today a dormant workspace's queued emails only drain
   on the *next* mutation. Add a slow periodic re-schedule (e.g. a `ClusterCron`
   or a low-frequency sweep in `apps/server`) so `available_at`-past rows are
   re-scheduled even when no new mutation arrives.

**Tests** (pattern: `packages/domain/src/post/workflow.test.ts` —
`@effect/vitest` `layer()` + `WorkflowEngine.layerMemory` + `TestClock` +
`TestMailer` mailbox + `Database.PgliteDatabaseLive`): kill the engine mid-batch
→ restart → remaining rows deliver (queue rows are durable; the workflow resumes
from SQL-backed storage); mutation + outbox write are atomic (force failure,
verify rollback); concurrent schedules collapse onto one claim; request latency
constant regardless of recipient count.

### Phase 2 — Batched dispatcher + per-recipient delivery records

**Problem:** no per-recipient tracking; dedupe on restart relies on workflow
idempotency alone; one bad address fails the whole activity.

1. **Dispatcher activity** per kind: group claimed rows, render each React Email
  template **once per batch**, reuse one SMTP connection, record per-recipient
  outcomes — `sent | skipped | failed | suppressed`.
2. **Idempotency**: keep the outbox claim + workflow idempotency key as the
  primary dedupe. Add a crash-restart guard: before re-sending, check
  `email_deliveries.provider_message_id` for the recipient (the existing
  `messageId` scheme — `<submission.${batchId}.${email}@notifications.feeblo>` —
  makes this a natural unique key).
3. **`email_deliveries` table**: `outbox_id`, `recipient`, `template`, `status`,
  `provider_message_id`, `attempts`, `sent_at`, `delivered_at`, `opened_at`,
  `error`. IDs via `@feeblo/id` factories (like `NotificationId`).
4. **Failure isolation**: one bad address (or a 5xx) never fails the batch —
  `Effect.forEach(..., { concurrency })` with per-recipient error capture inside
  the activity; the activity itself still retries per the outbox policy.

**Tests:** crash between SMTP accept and row update → no duplicate on restart
(provider_message_id guard); batch of 500 recipients = 1 render + one
connection; one invalid address doesn't fail the batch.

### Phase 3 — Stateless unsubscribe tokens + suppression list

**Problem:** no durable per-user unsubscribe; bounces never stop delivery.

1. **Unsubscribe tokens**: sign with the **established repo pattern** — a
  short-lived `jose` HS256 JWT (`packages/domain/src/jwt-secret/verification.ts`
  and `widget/sso.ts` already do exactly this: `aud`-bound, `exp`-validated,
  key rotation via a secrets list). Token payload = `{ memberId, postId | null,
  action, exp }`. No DB rows, no eager writes. The unsubscribe route validates
  signature + expiry and applies the action (unsubscribe post / mute all)
  through existing preference code.
2. **`suppressed_emails` table**: `email`, `reason` (hard_bounce | complaint |
  manual), `created_at`. The dispatcher excludes suppressed addresses before
  send and warns when one slips through.
3. **Webhook ingestion endpoint** (provider-agnostic, signature-validated):
  SMTP-only today means no bounce webhooks exist yet — build the ingestion route
  + mapping now so a provider that supports it (Resend/Postmark/SES) plugs in
  with zero dispatcher changes; record the event on `email_deliveries` and
  insert into `suppressed_emails` on hard bounce / complaint.
4. **Admin surface** (in the `apps/web` dashboard app): suppressed list with
  count + manual un-suppress.

**Tests:** unsubscribe works with no token row (signature-only); forged/expired
tokens rejected; hard bounce → suppression stops future sends; un-suppress
resumes delivery.

### Phase 4 — Frequency caps, digests, provider rate limiting

**Problem:** N comments in 10 minutes = N emails per member; no send-rate control.

1. **Per-member frequency cap**: max N notification emails per member per day
  (default ~10, configurable). Over-cap members are **held and coalesced, never
  dropped**. Implement with the existing `RateLimitService`
  (`packages/domain/src/rate-limit/service.ts` wraps
  `effect/unstable/persistence/RateLimiter` fixed-window; the Redis-vs-memory
  store is already wired in `apps/server/src/index.ts`).
2. **Windowed digests**: generalize the **existing submission cooldown** — the
  15-min `DurableClock.sleep` + queue-table coalescing *is* a windowed digest.
  Key by (member, post): first event schedules a delayed digest (~15 min), later
  events extend the payload into "N new comments on X". Critical kinds (mentions
  when added, password resets, security alerts) are always instant and never
  digested. Per-member preference for instant vs digest per kind, defaulting to
  current behavior. The `WeeklyDigest` component in `weekly-digest.tsx` is
  already built but unreferenced — adopt it as the digest UI starting point.
3. **Provider rate limiter**: a shared token bucket sized from config (sends/
  sec), backed by the same `RateLimiter` + Redis store, **fail-open**. The
  dispatcher consumes a token per send; a 429 (or SMTP throttling error) pauses
  the dispatcher and backs off the whole batch, not row-by-row.
4. **Per-workspace daily quota** wired to tier limits if the infra exists —
  enforced at enqueue time, overflow logged and admin-visible.

**Tests:** 10 comments in 10 min → 1 digest with count=10; mention during a
digest window still sends instantly; cap exceeded → held not dropped; simulated
throttle shapes throughput; quota overflow blocked with a clear reason.

### Phase 5 — Delivery observability

1. Admin dashboard (`apps/web`): per-template volume, success/error rates,
  suppressed count, digest vs instant split, dead-letter list.
2. Health check: extend the existing `/health` route (`apps/server/src/index.ts`)
  with SMTP-configured + last successful send timestamp; alert (log + optional
  webhook, via the existing `@sentry/effect` wiring) on >X consecutive failures.
3. Link `email_deliveries` rows to the originating post/action for support
  triage ("did this member get the email about post X?").

## 5. Constraints

- **Effect idioms throughout**: services via `Context.Service` +
  `Layer.effect`, errors via `Schema.TaggedErrorClass`, traceable methods via
  `Effect.fn`, effects via `Effect.gen`. No imperative service classes.
- **Durable workflows are the scheduler**: new email flows are `W.Workflow.make`
  + `.toLayer(Effect.fnUntraced(...))`, using `W.DurableClock.sleep` and
  `W.Activity.make` + `W.Activity.retry`, composed in
  `packages/domain/src/workflows.ts` exactly like the existing two workflows.
  Activities access `Mailer` and `Database.Database`; schedule via
  `Effect.serviceOption(WorkflowEngine)` and provide it explicitly
  (`Effect.provideService`) — the `PostRepository.scheduleSubmissionNotification`
  shape.
- **Transactions**: outbox/queue writes join the source mutation's
  `transaction(...)` via `currentDb` (fiber-local tx connection in
  `packages/db/src/database.ts`), like `NotificationService`. Best-effort
  post-commit scheduling, failure logged, never failing the user's action.
- **DB**: Drizzle schema in `packages/db/src/schema/`, migrations in
  `packages/db/src/migrations/` orchestrated by `@feeblo/db-migrator`; row IDs
  from `@feeblo/id` factories.
- **Config/env**: `@feeblo/config/effect` helpers (see `MailerConfig` in
  `packages/transactional/src/config.ts`); new env vars documented in
  `.env.example` alongside the existing `SMTP_*` block.
- **Signing**: reuse the `jose` HS256 pattern (`jwt-secret/verification.ts`,
  widget SSO) for unsubscribe tokens — do not introduce a new HMAC utility.
- **Rate limiting**: reuse `RateLimitService` / `effect/unstable/persistence/
  RateLimiter` and the Redis/memory store selection in `apps/server/src/index.ts`.
- **Logging/observability**: `Effect.annotateLogsScoped` for scoped context,
  `Effect.logError`/`logWarning` for failures, Sentry via `@sentry/effect`.
- Preserve public behavior: templates, unsubscribe UX, preference semantics,
  provider priority (SMTP → console/dev-log), and the auth emails (OTP,
  password reset, invitation) in `packages/auth/src/server.ts`.
- PII discipline: never log recipient addresses or token payloads.
- Every phase ships unit + integration tests (the `@effect/vitest` +
  `TestClock` + `WorkflowEngine.layerMemory` + `TestMailer` pattern from
  `packages/domain/src/post/workflow.test.ts`; E2E via `E2E_TEST_MAILER=true`
  and the `/__e2e/emails` endpoint) and a migration; update deploy docs and
  `.env.example` for new env vars.

## 6. Definition of done

- All 5 phases implemented in order; each with passing tests + a migration.
- Kill-the-server tests prove: no lost rows (queue/outbox rows are durable and
  re-drained; workflows resume from SQL-backed storage) and no duplicate emails
  (idempotency keys + `provider_message_id` guard).
- User write actions perform zero SMTP calls and complete in constant time
  regardless of recipient count (already true today — kept as an invariant).
- Admin surfaces exist for suppression, dead-letter, quotas, and delivery stats.
- One commit series per phase, phase named in the commit messages.

## 7. Suggested file map (verify against current layout before coding)

| Concern | Likely location |
| --- | --- |
| `email_events`, `email_deliveries`, `suppressed_emails` schemas | `packages/db/src/schema/` (new `schema/email.ts`; the `submission_notification_*` tables live in `schema/feedback.ts`) |
| Migrations | `packages/db/src/migrations/` (drizzle-kit generate + `@feeblo/db-migrator`) |
| `EmailOutboxService`, dispatcher activity, digest buffer, cap checks | `packages/domain/src/email/` (new subpackage) |
| Email workflows + layers | `packages/domain/src/email/workflow.ts` (new), composed in `packages/domain/src/workflows.ts` alongside the existing two |
| Scheduler | none new — in-process `ClusterWorkflowEngine` + `SingleRunner` in `apps/server/src/index.ts` (already wired); optional slow reaper via `ClusterCron` |
| Unsubscribe route (JWT validation + preference apply) | `apps/server` HTTP route (add to the router in `index.ts`) or existing auth router |
| Webhook ingestion (bounce/complaint) | `apps/server` HTTP route |
| Admin surfaces | `apps/web` dashboard app |
| Templates | `packages/transactional/src/templates/` (reuse `notification.tsx`, adopt `weekly-digest.tsx` for Phase 4) |

Start by reading `packages/domain/src/workflows.ts`, `post/workflow.ts`,
`user/workflows.ts`, `post/handlers.ts`, `post/repository.ts`,
`notification/service.ts`, `packages/transactional/src/mailer.ts`,
`test-mailer.ts`, `packages/db/src/database.ts`, and `docs/notifications.md`
end-to-end, then produce a concrete per-phase file-by-file plan before writing
code.
