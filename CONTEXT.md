# Feeblo

Customer feedback platform: feature requests collected on boards, with roadmaps, changelogs, and an embeddable widget. This glossary fixes the vocabulary shared by the codebase, the product, and its documentation.

## Language

### Feedback

**Post**: A feature request, bug report, or other item of feedback on a board. _Avoid_: Feature, feature request, ticket, issue

**Public portal**: The feedback-board and widget surface that is readable without a dashboard session. `*Public` in RPC names — `PostListPublic`, `PostGetPublic` — refers to this surface, not to anonymity and not to the Public API. _Avoid_: Public API, anonymous API

### Integrations

**Provider**: an external integration family. V1 implements the `webhook`, `slack`, and `discord` providers.

**Connection**: an organization-owned provider account or endpoint. A V1 webhook endpoint is one connection.

**Capability**: a provider feature, such as outbound event delivery.

**Route**: a configured capability instance below a connection. For webhooks it selects V1 event types.

**Integration Event**: an immutable, versioned fact recorded for external delivery.

**Delivery**: one durable attemptable execution of an event for one route; its ID is stable across retries.

**Inbox Event**: a future durable inbound provider event. It is not implemented for V1 webhooks.

**Binding**: a future durable local-to-remote entity relationship used by bidirectional sync. It is not implemented for V1; Slack and Discord identities currently resolve through the user table (email match where available, or stable synthetic email).

### Public API

**Public API**: The versioned, key-authenticated HTTP surface under `/api/v1` that lets a workspace read its own data programmatically. It is distinct from the public portal, which is open to anyone, and from the dashboard transport, which is session-authenticated RPC. _Avoid_: Customer API, Developer API, platform API, open API

**API key**: An organization-owned machine credential. It identifies the workspace that owns it, never a member, and carries its own scopes. _Avoid_: token, secret, personal access token, user key

**Scope**: A capability granted to an API key, drawn from the Public API's own vocabulary. Separate from a permission, which is granted to a member. _Avoid_: permission, role, entitlement
