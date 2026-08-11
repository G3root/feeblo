# Integrations workspace boundary

`integrations/core` contains provider-neutral contracts, event recording, persistence-facing delivery behavior, retry policy, and registry validation. Provider packages depend on core and never on one another. `integrations/webhook` owns Standard Webhooks signing, endpoint validation, HTTP transport, and provider-specific failure classification.

`packages/domain` emits domain facts and exposes organization-scoped management commands. `apps/server` is the static composition root: it constructs the registry, provides provider layers, and launches the scoped delivery worker. The dashboard consumes safe manifests and RPC responses only; it never imports credentials or provider SDKs.

Slack, Discord, Linear, HubSpot, inbox processing, bindings, and bidirectional synchronization are future phases, not packages or capabilities supplied by V1.

## Operations

The server exports delivery backlog, claimed backlog, provider latency/outcome, lease-recovery age/count, and automatic-pause metrics. Alerting should cover sustained backlog, lease-recovery spikes, and repeated automatic pauses. Traces carry only organization, connection, route, event, correlation, delivery, and provider identifiers; payloads, endpoint URLs, signing keys, response bodies, and decrypted credentials must never be attached. Retention cleanup runs hourly and removes V1 events, deliveries, and attempts after 30 days, then purges archived endpoint metadata.
