# Integration glossary

- **Provider**: an external integration family. V1 implements the `webhook`, `slack`, and `discord` providers.
- **Connection**: an organization-owned provider account or endpoint. A V1 webhook endpoint is one connection.
- **Capability**: a provider feature, such as outbound event delivery.
- **Route**: a configured capability instance below a connection. For webhooks it selects V1 event types.
- **Integration Event**: an immutable, versioned fact recorded for external delivery.
- **Delivery**: one durable attemptable execution of an event for one route; its ID is stable across retries.
- **Inbox Event**: a future durable inbound provider event. It is not implemented for V1 webhooks.
- **Binding**: a future durable local-to-remote entity relationship used by bidirectional sync. It is not implemented for V1; Slack and Discord identities currently resolve through the user table (email match where available, or stable synthetic email).
