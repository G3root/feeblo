# Email Outbox Architecture Plan

## Objective

Build a durable, provider-independent email outbox for Feeblo that supports:

- New-submission notifications for workspace administrators.
- Workspace-wide changelog subscriptions.
- Post status, official update, merge, and closure notifications.
- Double-opt-in verification and one-click unsubscribe.
- Plan-aware delivery without allowing free-plan email usage to become an uncontrolled cost or abuse vector.

Cloudflare Email Service will be the initial delivery provider. Effect Workflow and Feeblo's primary database will remain responsible for durable outbound execution.

## Product Decisions

### Plan behavior

- Free workspaces receive new-submission notifications at one configurable email address.
- The free recipient defaults to the workspace owner.
- Paid workspaces may notify every opted-in administrator.
- Changelog and post subscription emails are paid-plan features.
- A downgrade preserves verified subscriptions but pauses paid-only delivery.
- An upgrade resumes deliveries that are no more than seven days old.
- Older paused deliveries expire and are not replayed.
- There is no advertised per-workspace email quota initially. Internal throttles, circuit breakers, and spend controls protect the system.

### Submission notifications

- The notification intent is inserted atomically with the new submission; dispatch is woken only after the transaction commits successfully.
- Submission notifications are sent immediately.
- Failure or throttling of the email must never fail or roll back the submission.
- Free workspaces fan out to one configured recipient; paid workspaces fan out to opted-in administrators.

### Changelog subscriptions

- A visitor must subscribe manually.
- A subscription covers the entire changelog for one workspace.
- The subscriber must verify the email address through double opt-in.
- Only the first publication of a changelog entry sends automatically.
- Editing or recategorizing an already-published entry does not send again.
- An administrator may explicitly choose to send an update for a published entry.
- Category-specific subscriptions are deferred.

### Post subscriptions

- The post creator is subscribed automatically.
- Commenting or voting does not automatically subscribe a user.
- Other users must explicitly choose to subscribe.
- A post subscription sends email only for:
  - Status changes.
  - Official or administrator updates.
  - Post merges.
  - Post closures.
- Votes, ordinary comments, minor edits, and internal moderation actions do not send email.
- Every subscription email includes a one-click unsubscribe mechanism.

### Timing and coalescing

- Submission notifications send immediately.
- Changelog publications and explicit changelog updates send immediately.
- Official post updates, merges, and closures send immediately.
- Post status changes wait five minutes.
- Repeated status changes during that window are coalesced into one notification containing the final status.

### Reliability

- Delivery is at least once.
- Feeblo retries temporary failures and sends whose provider response is uncertain.
- Deterministic message IDs and database uniqueness make duplicates unlikely.
- A rare duplicate caused by an ambiguous provider timeout is preferable to silently losing a notification.

## Existing Foundation

Feeblo already has a submission-specific version of this design:

- `submission_notification_queue` is written during post creation.
- `SubmissionEmailNotificationWorkflow` provides durable background execution.
- `Mailer` renders React Email templates and sends through Nodemailer.
- The current workflow batches for 15 minutes and sends to every workspace member.

The implementation should evolve this foundation rather than introduce a second outbound job system. The existing workflow needs to be generalized, the submission delay removed, and recipient selection corrected.

## Architecture

```text
Product transaction
  -> atomically records an email intent

Outbox dispatcher workflow
  -> checks policy and plan
  -> waits or coalesces when required
  -> resolves eligible recipients
  -> snapshots template data
  -> creates one delivery per recipient

Delivery workflow
  -> checks plan, consent, and suppression again
  -> renders the versioned template payload
  -> sends through Mailer
  -> records the provider result
  -> retries retryable or uncertain failures

Cloudflare lifecycle event ingestion
  -> correlates by message ID
  -> records delivered, deferred, bounced, or failed
  -> suppresses addresses after permanent failures
```

Cloudflare Email Service is a transport adapter, not the source of truth for pending Feeblo email. Cloudflare Queues are not needed for outbound execution. A Cloudflare Queue or HTTP pull consumer may still be used to ingest Cloudflare delivery events.

## Domain Model

### Email intent

An email intent records that a product event may produce email. It is created atomically with the product change so that a successful change cannot lose its notification.

Supported initial intent kinds:

- `submission.created`
- `changelog.published`
- `changelog.update_requested`
- `post.status_changed`
- `post.official_update_published`
- `post.merged`
- `post.closed`

An intent is not yet an email to a specific address. Recipient resolution and plan enforcement happen during materialization.

### Email delivery

An email delivery is one immutable attempt to deliver one intent to one recipient. Retry state belongs to the delivery, allowing one failed address to retry without resending to successful recipients.

### Email contact

An email contact is an address known in the context of one workspace. It may reference a Feeblo user, but external changelog subscribers do not need Feeblo accounts.

### Email subscription

An email subscription connects a verified contact to a topic. Initial topic types are:

- Workspace changelog.
- Individual post.

The subscription records whether it was explicit or created because the contact authored the post.

### Suppression

A suppression prevents delivery to an address that has permanently bounced, complained, or been administratively blocked. Suppression is distinct from unsubscribe: unsubscribe expresses recipient choice for a topic, while suppression protects deliverability across sends.

## Data Model

Names are provisional and should follow repository naming conventions during implementation.

### `email_outbox`

| Column | Purpose |
| --- | --- |
| `id` | Stable intent identifier. |
| `organization_id` | Owning workspace. |
| `kind` | Discriminated email intent kind. |
| `aggregate_type` | Source entity type. |
| `aggregate_id` | Source entity identifier. |
| `deduplication_key` | Unique business key preventing duplicate intents. |
| `payload` | Effect Schema-validated event data. |
| `scheduled_at` | Earliest materialization time. |
| `expires_at` | Point after which the intent must not send. |
| `state` | `pending`, `materialized`, `paused_by_plan`, `failed`, or `expired`. |
| `created_at` / `updated_at` | Audit timestamps. |

Use a unique index on `deduplication_key`.

For a status change, the deduplication key should identify the post's open coalescing window. Its payload may be updated until the five-minute window closes. Other intent payloads are immutable.

### `email_delivery`

| Column | Purpose |
| --- | --- |
| `id` | Stable delivery identifier. |
| `outbox_id` | Parent intent. |
| `contact_id` | Recipient contact when applicable. |
| `recipient_email` | Normalized address snapshot used for this delivery. |
| `template` | Stable template identifier. |
| `template_version` | Renderer version. |
| `template_payload` | Immutable, Effect Schema-validated rendering data. |
| `message_id` | Deterministic RFC message ID. |
| `state` | Delivery lifecycle state. |
| `attempt_count` | Number of provider attempts. |
| `next_attempt_at` | Retry scheduling time. |
| `accepted_at` / `delivered_at` | Provider lifecycle timestamps. |
| `last_error` | Typed, safe diagnostic data. |
| `provider_metadata` | Cloudflare identifiers needed for correlation. |
| `created_at` / `updated_at` | Audit timestamps. |

Use a unique index on `(outbox_id, recipient_email)` and another on `message_id`.

Initial delivery states:

- `queued`
- `sending`
- `accepted`
- `delivered`
- `deferred`
- `bounced`
- `failed`
- `suppressed`
- `paused_by_plan`
- `expired`

### `email_contact`

| Column                      | Purpose                  |
| --------------------------- | ------------------------ |
| `id`                        | Contact identifier.      |
| `organization_id`           | Workspace scope.         |
| `user_id`                   | Optional Feeblo user.    |
| `email`                     | Normalized address.      |
| `verification_state`        | `pending` or `verified`. |
| `verified_at`               | Verification timestamp.  |
| `created_at` / `updated_at` | Audit timestamps.        |

Use a unique index on `(organization_id, email)`.

### `email_subscription`

| Column | Purpose |
| --- | --- |
| `id` | Subscription identifier. |
| `organization_id` | Workspace scope. |
| `contact_id` | Subscriber. |
| `topic_type` | `changelog` or `post`. |
| `topic_id` | Null for the workspace changelog; post ID for a post. |
| `source` | `explicit` or `post_creator`. |
| `state` | `pending_verification`, `active`, `paused_by_plan`, or `unsubscribed`. |
| `verification_token_hash` | Hash of the short-lived confirmation token. |
| `verification_expires_at` | Confirmation expiry. |
| `unsubscribe_token_hash` | Hash used for one-click unsubscribe. |
| `verified_at` / `unsubscribed_at` | Lifecycle timestamps. |
| `created_at` / `updated_at` | Audit timestamps. |

Use a unique index covering the contact and topic.

### `email_suppression`

| Column              | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `email`             | Normalized suppressed address.                   |
| `reason`            | Hard bounce, complaint, or administrative block. |
| `provider_event_id` | Idempotency for provider feedback.               |
| `created_at`        | Suppression timestamp.                           |

## Outbox and Transaction Boundaries

The product mutation and its outbox insert must use the same database transaction:

1. Validate the product command.
2. Apply the product mutation.
3. Insert immutable intents with `onConflictDoNothing` against their business deduplication key. For an open status-coalescing window, conditionally update the pending intent payload instead.
4. Commit.
5. Best-effort wake the dispatcher.

Starting a workflow is not part of the database transaction. A periodic reconciliation workflow must scan eligible pending intents and start any missing dispatcher workflows. This closes the failure window where the transaction commits but the post-commit wake-up fails.

## Dispatcher Responsibilities

The dispatcher converts an intent into deliveries:

1. Load and decode the intent with Effect Schema.
2. Wait until `scheduled_at` for coalesced events.
3. Reject expired intents.
4. Check the organization's current plan.
5. Apply the policy for the intent kind.
6. Resolve eligible and opted-in recipients.
7. Exclude unsubscribed or suppressed contacts.
8. Snapshot template data and template version.
9. Insert one delivery per recipient idempotently.
10. Start one delivery workflow per queued delivery.
11. Mark the intent materialized.

Recipient resolution must happen after the product transaction. Sending email or rendering templates must never happen inside the product transaction.

## Delivery Workflow

Each delivery is independent:

1. Reload the delivery.
2. Stop if it is already terminal.
3. Recheck plan eligibility for paid-only mail.
4. Recheck subscription consent and suppression.
5. Expire paid mail older than seven days.
6. Atomically transition from `queued` or `deferred` to `sending`.
7. Render HTML and plain text from the immutable versioned payload.
8. Send through `Mailer` with the deterministic message ID.
9. Record acceptance metadata.
10. Retry temporary or uncertain failures with bounded exponential backoff and jitter.
11. Mark permanent failures terminal.

Effect Workflow should own durable delays and retry execution. The database tables remain the inspectable product and operational record.

## Entitlements

Extend the plan catalog with email-specific features:

- A capability such as `subscriberEmails`, disabled on free and enabled on paid plans.
- A limit such as `submissionNotificationRecipients`, set to `1` on free and unlimited on paid plans.

Add focused policy operations rather than checking plan names directly:

- Determine whether a workspace may create public email subscriptions.
- Determine whether an intent kind may materialize.
- Return the allowed submission-notification recipient count.

Eligibility is checked twice:

- At intent creation, to avoid knowingly creating ineligible work.
- Before materialization or delivery, to honor plan changes while mail is queued.

Paid-only deliveries become `paused_by_plan` after downgrade. They are retained for seven days and then expired. Subscription records remain paused indefinitely and reactivate on upgrade.

## Consent and Unsubscribe

- Changelog subscriptions always require double opt-in.
- Explicit post subscriptions require a verified Feeblo user email or double opt-in for an external contact.
- Post-author subscriptions may use the author's already-verified account email.
- Verification and unsubscribe tokens must be random, single-purpose, hashed at rest, and safely expiring where appropriate.
- Unsubscribe endpoints must be idempotent and must not require authentication.
- Subscription email should include both a visible unsubscribe link and appropriate list-unsubscribe headers.
- Unsubscribing affects the selected topic, not unrelated authentication or administrative email.

## Abuse and Cost Controls

Do not expose a fixed customer email quota initially. Add configurable internal controls:

- Public submission limits per IP and workspace.
- Subscription-verification limits per IP, address, and workspace.
- Submission-notification circuit breakers per workspace.
- Global provider spend and volume circuit breakers.
- Limits on concurrent sends.
- Alerts for unusual bounce, failure, or send-rate changes.

If an email is throttled, the product action still succeeds. Record the delivery or intent outcome so operators can distinguish throttling from provider failure.

## Cloudflare Email Service Adapter

Keep provider behavior behind `Mailer`.

The first implementation may use Cloudflare's authenticated SMTP endpoint because the current service already uses Nodemailer. Update `Mailer.send` to return a provider-neutral result containing:

- Message ID.
- Whether the provider accepted the message.
- Safe provider metadata needed for correlation.

Do not expose Cloudflare response types to domain workflows. A future REST implementation should be replaceable at the layer boundary.

Configure Cloudflare lifecycle event subscriptions for:

- Delivered.
- Deferred.
- Bounced.
- Failed.

Event ingestion must be idempotent by provider event ID. Permanent bounces create or update local suppression records. Deferred events update observability but do not independently trigger duplicate Feeblo retries while Cloudflare is still retrying.

## Observability

Emit structured logs, traces, and metrics with:

- Organization ID.
- Intent and delivery ID.
- Intent kind and template version.
- Attempt count.
- Current state.
- Provider message ID.
- Suppression, throttle, pause, expiry, and failure reason.

Initial metrics should include:

- Intents created and materialized.
- Deliveries accepted, delivered, deferred, bounced, failed, suppressed, paused, and expired.
- Retry counts and age of the oldest queued delivery.
- Sends by workspace plan and intent kind.
- Estimated monthly provider cost.
- Reconciliation recoveries.

Avoid logging email bodies, verification tokens, unsubscribe tokens, or raw provider credentials.

## Testing Strategy

### Domain and repository tests

- Product mutation and outbox insert commit atomically.
- Duplicate business events produce one intent.
- Recipient fan-out follows free and paid plan policy.
- Downgrade pauses and upgrade resumes eligible recent delivery.
- Paid-only deliveries paused by a downgrade expire after seven days.
- Changelog publication sends once; edits do not.
- Explicit changelog update creates a distinct intent.
- Post creators subscribe automatically.
- Comments and votes do not subscribe users.
- Repeated status changes coalesce to the final status.
- Suppressed and unsubscribed contacts never receive deliveries.

### Workflow tests

- Post-commit wake-up starts the dispatcher.
- Reconciliation recovers an intent whose wake-up was lost.
- Each recipient retries independently.
- Temporary and ambiguous failures retry.
- Permanent failures do not retry forever.
- Terminal delivery states are idempotent.
- Workflow restarts do not duplicate deliveries.

### Provider adapter tests

- SMTP/provider responses map to typed provider-neutral results.
- Deterministic message IDs are preserved.
- Cloudflare lifecycle events update the correct delivery.
- Duplicate lifecycle events are harmless.
- Hard bounces create suppressions.

### End-to-end tests

- Free submission emails only the configured recipient.
- Paid submission emails opted-in administrators.
- Double opt-in activates a changelog subscription.
- Publishing a changelog sends the verified subscriber an email.
- Unsubscribe prevents subsequent email.
- Downgrade pauses subscription delivery and upgrade resumes eligible recent mail.

## Migration Strategy

1. Add the generic outbox, delivery, contact, subscription, and suppression schema without removing existing submission tables.
2. Implement dispatcher, delivery, and reconciliation workflows behind the test mailer.
3. Dual-write submission intents temporarily while the generic path is verified, but send through only one path.
4. Switch submission sending to the generic outbox.
5. Change free recipient resolution to the configured address and paid resolution to opted-in administrators.
6. Remove the 15-minute submission batching behavior.
7. Add Cloudflare transport and lifecycle event ingestion.
8. Add changelog subscription and verification flows.
9. Add the new post email-subscription policy and stop subscribing commenters and voters automatically.
10. Add status coalescing and the remaining post event types.
11. Remove the old submission queue and batch tables after production verification.

## Implementation Slices

Each slice should be implemented test-first and leave the system deployable.

1. **Outbox schema and repository**
   - Typed intent kinds and payload schemas.
   - Atomic insertion and deduplication tests.

2. **Delivery schema and state machine**
   - Valid transitions and independent recipient records.
   - Immutable template payloads.

3. **Dispatcher and reconciliation**
   - Materialization, workflow wake-up, and recovery of missed wake-ups.

4. **Delivery workflow**
   - Rendering, provider call, retries, terminal states, and test-mailer coverage.

5. **Submission migration**
   - Immediate delivery, one free recipient, paid administrator fan-out, and removal of old batching behavior.

6. **Cloudflare adapter**
   - SMTP configuration, provider-neutral send result, production configuration, and local/test behavior.

7. **Contacts, consent, and unsubscribe**
   - Verification tokens, double opt-in, unsubscribe, and suppression checks.

8. **Changelog subscriptions**
   - Workspace-wide manual subscriptions, first-publish behavior, and explicit update sends.

9. **Post subscription policy**
   - Creator auto-subscribe, explicit opt-in for others, and removal of comment/upvote auto-subscription.

10. **Post notification events**
    - Status coalescing, official updates, merges, and closures.

11. **Provider feedback and suppression**
    - Event ingestion, delivery correlation, bounce handling, and idempotency.

12. **Guardrails and operations**
    - Rate limits, circuit breakers, metrics, alerts, and operational inspection tools.

## Non-goals for the First Version

- Changelog category subscriptions.
- Daily or weekly digests.
- Custom sending domains per workspace.
- Marketing campaigns.
- Arbitrary administrator-authored email broadcasts.
- Attachments.
- Replacing Effect Workflow with Cloudflare Queues.
- A customer-visible email usage quota or billing meter.

## Completion Criteria

The architecture is complete when:

- Every supported product event records its email intent atomically.
- Missed workflow wake-ups recover automatically.
- Each recipient has an independently retryable and observable delivery.
- Free and paid behavior matches the agreed policies.
- Consent, unsubscribe, and suppression are enforced before delivery.
- Cloudflare is replaceable behind the provider-neutral mailer interface.
- Production operators can identify queued, paused, throttled, failed, bounced, and delivered email without inspecting provider dashboards alone.
