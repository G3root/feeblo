# Integrations workspace boundary

`integrations/core` contains provider-neutral contracts, event recording, persistence-facing delivery behavior, retry policy, and registry validation. Provider packages depend on core and never on one another. `integrations/webhook` owns Standard Webhooks signing, endpoint validation, HTTP transport, and provider-specific failure classification.

`packages/domain` emits domain facts and exposes organization-scoped management commands. `apps/server` is the static composition root: it constructs the registry, provides provider layers, and launches the scoped delivery worker. The dashboard consumes safe manifests and RPC responses only; it never imports credentials or provider SDKs.

## Slack provider

`integrations/slack` implements the Slack provider (`slack`, OAuth 2.0):

- **`channel.notifications`** (outbound) — one route per channel; the durable delivery worker posts a `ChannelUpdateMessage` rendered into Slack blocks for every `feedback.post.created` event. Public channels are auto-joined on the first post (`conversations.join`, `channels:join` scope); private channels require a member to add the bot first (`conversations.list` reports membership per channel).
- **`commands`** and **`message.action`** (inbound) — the `/feeblo` slash command and the “Send to Feeblo” message action open the feedback modal (title, details, board). `view_submission` creates a post (source `SLACK`) and subscribes the Slack user to request notifications. Slack identities resolve against the user table: a visible Slack email matching an existing Feeblo user of the organization reuses that account, otherwise a stable anonymous user is created (synthetic team-scoped email `slack-<team>-<user>@slack.invalid`, `emailVerified: false`). The bot token is encrypted at rest with `INTEGRATION_ENCRYPTION_KEY` (falling back to `AUTH_ENCRYPTION_KEY` when unset, matching the webhook provider).

Inbound requests are signature-verified (HMAC-SHA256, 5-minute freshness window) by the provider before any domain work. The server mounts `/slack/oauth/callback`, `/slack/commands/feeblo`, and `/slack/interactive`. The dashboard settings page (`/$organizationId/settings/integrations/slack`, `integrations.manage`) handles workspace connect/disconnect and per-channel notification toggles.

Discord, Linear, HubSpot, inbox processing, bindings, bidirectional synchronization, and in-modal similar-request upvoting are future phases, not packages or capabilities supplied by V1.

## Operations

The server exports delivery backlog, claimed backlog, provider latency/outcome, lease-recovery age/count, and automatic-pause metrics. Alerting should cover sustained backlog, lease-recovery spikes, and repeated automatic pauses. Traces carry only organization, connection, route, event, correlation, delivery, and provider identifiers; payloads, endpoint URLs, signing keys, response bodies, and decrypted credentials must never be attached. Retention cleanup runs hourly and removes V1 events, deliveries, and attempts after 30 days, then purges archived endpoint metadata.
