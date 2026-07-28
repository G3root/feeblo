# Feedback ingestion and triage

Feeblo’s feedback ingestion feature provides one normalized path for feedback arriving from the widget, public portal, dashboard, API, imports, Slack, or email. It preserves the original submission, connects the sender to a Feeblo contact when possible, produces a triage-ready assessment, and lets an owner or admin resolve it without creating duplicate posts or votes.

The ingestion pipeline is intentionally separate from source adapters. A Slack listener, email receiver, CSV importer, or other adapter only needs to translate its payload into the `FeedbackCapture` contract. The durable workflow and triage behavior remain the same for every channel.

## End-to-end flow

```text
Source adapter or authenticated client
        │
        └─ FeedbackCapture
              │
              ├─ upserts the feedback channel
              ├─ stores a feedback receipt transactionally
              └─ returns CREATED or DUPLICATE
                    │
                    └─ schedules FeedbackIngestionWorkflow
                          │
                          ├─ MatchFeedbackContact
                          ├─ LoadFeedbackReceipt
                          ├─ AssessFeedback
                          └─ SaveFeedbackTriageItem
                                │
                                └─ owner/admin reviews Incoming feedback
                                      ├─ create a post
                                      ├─ link to an existing post
                                      └─ ignore
```

The receipt is committed before workflow scheduling. If the same delivery is captured again, Feeblo returns the original receipt ID and schedules the same workflow identity. Database uniqueness and the workflow idempotency key make retries safe.

## Domain vocabulary

| Term | Meaning |
| --- | --- |
| Channel | A configured origin within a workspace, such as a Slack channel, API client, widget, or import |
| Receipt | The normalized record of one delivered feedback message, plus its pipeline stage |
| Identity link | A channel-specific mapping from an upstream sender ID to a Feeblo contact |
| Assessment | The structured interpretation produced from a receipt |
| Triage item | The assessment and proposed action presented to an operator |
| Delivery key | A source-provided stable key used to deduplicate delivery retries |

## Capture contract

`FeedbackCapture` accepts:

```ts
{
  organizationId,
  channel: {
    key: "slack:C123",
    kind: "SLACK",
    label: "#customer-feedback"
  },
  upstreamItemId: "1700000000.000100",
  deliveryKey: "slack:C123:1700000000.000100",
  sender: {
    upstreamId: "U123",
    email: "customer@example.com",
    name: "Ada Customer"
  },
  message: {
    title: "Export audit trail",
    text: "We need to see who exported every report."
  },
  metadata: {
    channelId: "C123",
    threadTimestamp: "1700000000.000100"
  }
}
```

Only `organizationId`, the channel fields, `deliveryKey`, `sender`, and `message.text` are required. Optional metadata is retained as structured JSON so an adapter can preserve source-specific context without changing the core schema.

The response is:

```ts
{
  status: "CREATED" | "DUPLICATE",
  receiptId
}
```

An empty message, channel key, or delivery key is rejected before persistence.

## Idempotency

Receipts are unique by:

```text
organizationId + channelId + deliveryKey
```

The channel itself is unique by:

```text
organizationId + channel.key
```

An adapter should derive `deliveryKey` from the source’s immutable event or message identifier. It must not use a random value. Examples include:

- Slack: workspace/channel/message timestamp
- Email: provider message ID
- API: caller-supplied idempotency key
- CSV: import job ID and row number
- Widget or portal: submission ID

The durable workflow uses `receiptId` as its idempotency key. Assessment persistence is also unique by `receiptId`, so a repeated or replayed execution cannot create another triage item.

## Contact identity resolution

The `MatchFeedbackContact` activity resolves identity in this order:

1. Reuse the contact already attached to the receipt.
2. Look up a channel-specific identity link using `sender.upstreamId`.
3. Match an existing workspace contact by email.
4. Create a contact when the message contains enough identity information.
5. Store an identity link for future deliveries from the same upstream sender.
6. Continue without a contact when the sender is anonymous.

Identity-link creation is protected by a unique database index. Concurrent messages from the same upstream sender converge on the canonical contact, and an unused contact created by a losing race is removed before the transaction commits.

## Assessment

`FeedbackAssessor` is the replaceable interpretation boundary. Its output contains:

- `digest`
- supporting `excerpts`
- inferred `customerNeed`
- `tone`
- `priority`
- `interpretationConfidence`
- a proposal containing an action, title/body, optional target board/post, and rationale

The current `manualLayer` is deterministic. It normalizes the message, derives a title, and proposes `CREATE_POST`. It does not call an AI model. A future AI-backed layer can replace it without changing capture, persistence, workflow, RPC, or dashboard contracts.

An assessor implementation should remain deterministic enough to retry safely and must return only validated Effect Schema output.

## Durable Effect workflow

`FeedbackIngestionWorkflow` contains four activities:

| Activity | Responsibility | Retry behavior |
| --- | --- | --- |
| `MatchFeedbackContact` | Resolve or create the Feeblo contact | Three retries |
| `LoadFeedbackReceipt` | Load the normalized sender, message, and metadata | Three retries |
| `AssessFeedback` | Produce the structured assessment and proposal | Controlled by the assessor |
| `SaveFeedbackTriageItem` | Persist the assessment and mark the receipt ready | Three retries |

Database activities use transactions. Operational failures are converted to typed `FeedbackProcessingDataError` values. If processing ultimately fails, the receipt moves to `FAILED` and stores `failureDetail`. Successful processing moves it to `READY`.

The workflow layer is registered with the other application workflows in `packages/domain/src/workflows.ts`.

## Persistence model

The feature uses four tables:

| Table | Purpose |
| --- | --- |
| `feedback_channel` | Workspace-scoped channel configuration |
| `feedback_receipt` | Normalized source delivery and pipeline stage |
| `contact_identity_link` | Upstream sender-to-contact mapping per channel |
| `feedback_triage_item` | Assessment, proposed action, and final decision |

Assessment and proposal data live in one triage table because they have a one-to-one lifecycle. Splitting them would add a join and require coordinating two records without adding an independent behavior.

Important database invariants include:

- one receipt per channel delivery key;
- one identity link per channel and upstream contact ID;
- one triage item per receipt;
- interpretation confidence is either `null` or between `0` and `1`;
- open triage items cannot contain decision metadata;
- created or linked posts require a resolved post ID;
- ignored triage items cannot contain a resolved post ID.

## Triage actions

Only open triage items can be resolved. Each action locks the triage row and performs its work in one database transaction.

### Create a post

`FeedbackTriageCreatePost`:

- verifies that the selected board and status belong to the workspace;
- uses operator overrides or the proposed title and body;
- sanitizes the content;
- creates the post with the resolved contact and source attribution;
- records `POST_CREATED` and `FEEDBACK_ATTACHED` activities;
- queues the existing submission notification;
- marks the triage item `POST_CREATED`.

### Link to an existing post

`FeedbackTriageLinkPost`:

- verifies that the post belongs to the workspace;
- adds a contact-backed vote when the receipt has a resolved contact;
- records a `FEEDBACK_ATTACHED` activity;
- marks the triage item `POST_LINKED`.

Contact-backed votes have a unique contact/post constraint. A person represented by a contact can therefore contribute at most one vote to a post through ingestion.

### Ignore

`FeedbackTriageIgnore` records the operator decision and marks the item `IGNORED` without creating or changing a post.

A second resolution attempt fails with `FeedbackTriageAlreadyDecidedError`.

## Permissions

All current ingestion RPCs use authenticated dashboard sessions.

| RPC | Required permission |
| --- | --- |
| `FeedbackCapture` | Workspace membership |
| `FeedbackTriageList` | Workspace owner or admin |
| `FeedbackTriageCreatePost` | Workspace owner or admin |
| `FeedbackTriageLinkPost` | Workspace owner or admin |
| `FeedbackTriageIgnore` | Workspace owner or admin |

Handlers derive the acting user and membership from `CurrentSession`. The client cannot choose the deciding member or activity actor.

An unattended source adapter must introduce an appropriate authenticated transport boundary before calling the ingestion service. Supporting a channel kind in the schema does not by itself expose a public webhook.

## Dashboard

The dashboard route is:

```text
/:organizationId/feedback/incoming
```

The page polls open triage items every 15 seconds and uses the existing board, post-status, and post collections for resolution targets. Operators can:

- inspect channel, sender, priority, tone, digest, need, and source excerpt;
- create a post in a selected board and status;
- link the feedback to an existing post as a contact-backed vote;
- ignore the item.

After a resolution, the queue and post collection are refreshed.

## Adding a source adapter

To add Slack, email, CSV, or another source:

1. Authenticate and verify the source request at the transport boundary.
2. Resolve the destination `organizationId`.
3. Choose a stable channel `key`.
4. Derive a deterministic `deliveryKey`.
5. Map the source sender into `sender`.
6. Preserve useful source values in `metadata`.
7. Call `FeedbackIngestionService.capture` or the `FeedbackCapture` RPC where session authentication is appropriate.
8. Treat both `CREATED` and `DUPLICATE` as successful delivery.

Do not implement separate contact matching, assessment persistence, or post creation logic inside an adapter.

## Main implementation files

- `packages/db/src/schema/ingestion.ts` — tables, enums, indexes, and constraints
- `packages/domain/src/feedback-ingestion/schema.ts` — shared Effect schemas
- `packages/domain/src/feedback-ingestion/repository.ts` — persistence and identity matching
- `packages/domain/src/feedback-ingestion/interpreter.ts` — assessment boundary
- `packages/domain/src/feedback-ingestion/workflow.ts` — durable workflow
- `packages/domain/src/feedback-ingestion/service.ts` — capture and atomic triage actions
- `packages/domain/src/feedback-ingestion/rpcs.ts` — RPC definitions
- `packages/domain/src/feedback-ingestion/handlers.ts` — authorization and transport handlers
- `apps/web/src/dashboard/features/feedback-ingestion/components/incoming-feedback-page.tsx` — operator queue
- `packages/domain/src/feedback-ingestion/ingestion.test.ts` — PGlite integration coverage

## Verification

The integration tests use a real PGlite database with the generated migrations. They cover:

- duplicate delivery capture;
- repeated upstream identity resolution;
- contact-backed vote creation;
- prevention of a second triage decision;
- execution of the durable workflow through assessment and persistence.

Run the focused test with:

```sh
pnpm --filter @feeblo/domain exec vitest run src/feedback-ingestion/ingestion.test.ts
```
