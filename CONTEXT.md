# Feeblo

Customer feedback platform: feature requests collected on boards, with roadmaps, changelogs, and an embeddable widget. This glossary fixes the vocabulary shared by the codebase, the product, and its documentation.

## Language

### Surfaces

**Surface**: A transport the product answers on. The dashboard and the public portal are the two session-facing RPC surfaces; the Public API is the key-authenticated HTTP surface. An RPC write present on both RPC surfaces is implemented once and takes its surface, while each surface keeps its own RPC names, middleware, and error contract. The portal's RPC names carry a `Public` suffix (`ToggleUpvote` → `ToggleUpvotePublic`), which is what lets a shared body derive its rate-limit bucket from the operation and the surface. _Avoid_: channel, client, platform

### Feedback

**Post**: A feature request, bug report, or other item of feedback on a board. _Avoid_: Feature, feature request, ticket, issue

**Public portal**: The feedback-board and widget surface that is readable without a dashboard session. `*Public` in RPC names — `ListPostsPublic`, `GetPostPublic` — refers to this surface, not to anonymity and not to the Public API. _Avoid_: Public API, anonymous API

**Reaction**: An emoji a person attaches to a post or to a comment, one per person per emoji; toggling the same emoji again removes it. A reaction is not an upvote: an upvote is a vote for a post and counts toward its ranking, while a reaction is a lightweight expression on a post or a comment. Each target owns its own table, DTO, and RPC group; the two share one authorization shape, one toggle semantic, and one failure vocabulary. _Avoid_: like, emoji vote, thumbs up

### Data transfer

**Export**: a workspace's posts — every board's, or one board's — rendered as a CSV file the workspace downloads. _Avoid_: download, dump, backup

**Import job**: one staged CSV upload and its apply progress — the file it came from, the parsed row ledger, and what happened to every row until the job is finished or canceled. _Avoid_: upload, batch, migration

**Row report**: one import job's per-row outcomes, keyed by the file's line number. _Avoid_: error log, results

### Deliverability

**Suppression**: A durable instruction not to mail one address for one sender. A workspace suppression silences that workspace; a platform suppression covers mail that belongs to no workspace — account verification, password reset — and applies to every sender. A suppression is not an unsubscribe: an unsubscribe is the recipient's own consent decision about a topic, and it lives on the subscription. _Avoid_: blocklist, blacklist, unsubscribe

**Provider feedback**: A bounce, complaint, delivery delay, or rejection reported by the outbound provider for one delivery. _Avoid_: webhook event

**Hard bounce**: A provider's permanent rejection of an address — it does not exist or cannot receive. The only bounce classification that suppresses. **Soft bounce** is a temporary condition (full mailbox, greylist) and is retried; **undetermined bounce** is one the provider could not classify and is retried rather than suppressed.

### Integrations

**Provider**: an external integration family. V1 implements the `webhook`, `slack`, and `discord` providers.

**Chat provider**: the provider family Slack and Discord belong to — a chat platform whose channels receive notifications and deliver inbound feedback. Members share one management contract shape and one inbound feedback intake, and differ in OAuth, API, and payload shapes. _Avoid_: messaging provider, bot provider

**Connection**: an organization-owned provider account or endpoint. A V1 webhook endpoint is one connection.

**Capability**: a provider feature, such as outbound event delivery.

**Route**: a configured capability instance below a connection. For webhooks it selects V1 event types.

**Integration Event**: an immutable, versioned fact recorded for external delivery.

**Delivery**: one durable attemptable execution of an event for one route; its ID is stable across retries.

**Inbox Event**: a future durable inbound provider event. It is not implemented for V1 webhooks.

**Binding**: a future durable local-to-remote entity relationship used by bidirectional sync. It is not implemented for V1; Slack and Discord identities currently resolve through the user table (email match where available, or stable synthetic email).

### Membership

**Member**: A person with access to a workspace. The plan's member allowance counts every member, whatever their role, and the owner is one of them. _Avoid_: user, seat, account

**End user**: A person who posts, votes, or comments on the public board or through the widget. An end user is not a member and never consumes the member allowance; end users are unlimited on every plan. _Avoid_: customer, visitor, anonymous member

**Admin role**: A member holding `owner` or `admin`. It grants workspace management permissions; it is no longer a plan unit, so promoting a member does not change what the plan counts. _Avoid_: privileged member, seat, admin seat

### Plans

**Plan**: The subscription tier a workspace belongs to — Free, Starter, or Professional. _Avoid_: tier, package, subscription

**Entitlement**: A capability or allowance a plan grants. A capability is on or off; a limit is a count. _Avoid_: feature flag, quota

**Over-plan**: A workspace that holds more boards, members, changelog categories, or CRM entries than its plan allows, or a private board or roadmap its plan does not include. _Avoid_: downgraded, over quota, over limit

**Remediation**: The act of bringing an over-plan workspace back inside its plan, by changing or deleting its own state, or by upgrading. _Avoid_: restore, cleanup, fix

**Remediation action**: One explicit change that resolves a single over-plan finding — making a board or roadmap public, removing a member, cancelling an invitation, or deleting a resource. _Avoid_: fix, step, task

### Public API

**Public API**: The versioned, key-authenticated HTTP surface under `/api/v1` that lets a workspace read its own data programmatically. It is distinct from the public portal, which is open to anyone, and from the dashboard transport, which is session-authenticated RPC. _Avoid_: Customer API, Developer API, platform API, open API

**API key**: An organization-owned machine credential. It identifies the workspace that owns it, never a member, and carries its own scopes. _Avoid_: token, secret, personal access token, user key

**Scope**: A capability granted to an API key, drawn from the Public API's own vocabulary. Separate from a permission, which is granted to a member. _Avoid_: permission, role, entitlement

**Operation**: One unit of Public API behavior — typed input, output, failure vocabulary, scope, and MCP-style annotations, with one handler. Declared in the feature's `packages/domain/src/<feature>/public-api/operations.ts`. The HTTP endpoint and a future MCP tool are two projections of the same operation, so neither projection owns the behavior. _Avoid_: endpoint, handler, route, tool
