# Integrations workspace boundary

`integrations/core` contains provider-neutral contracts, event recording, persistence-facing delivery behavior, retry policy, and registry validation. Provider packages depend on core and never on one another. `integrations/webhook` owns Standard Webhooks signing, endpoint validation, HTTP transport, and provider-specific failure classification.

`packages/domain` emits domain facts and exposes organization-scoped management commands. `apps/server` is the static composition root: it constructs the registry, provides provider layers, and launches the scoped delivery worker. The dashboard consumes safe manifests and RPC responses only; it never imports credentials or provider SDKs.

## Slack provider

`integrations/slack` implements the Slack provider (`slack`, OAuth 2.0):

- **`channel.notifications`** (outbound) — one route per channel; the durable delivery worker posts a `ChannelUpdateMessage` rendered into Slack blocks for every `feedback.post.created` event. Public channels are auto-joined on the first post (`conversations.join`, `channels:join` scope); private channels require a member to add the bot first (`conversations.list` reports membership per channel).
- **`commands`** and **`message.action`** (inbound) — the `/feeblo` slash command and the “Send to Feeblo” message action open the feedback modal (title, details, board). `view_submission` creates a post (source `SLACK`) and subscribes the Slack user to request notifications. Slack identities resolve against the user table: a visible Slack email matching an existing Feeblo user of the organization reuses that account, otherwise a stable anonymous user is created (synthetic team-scoped email `slack-<team>-<user>@slack.invalid`, `emailVerified: false`). The bot token is encrypted at rest with `INTEGRATION_ENCRYPTION_KEY` (falling back to `AUTH_ENCRYPTION_KEY` when unset, matching the webhook provider).

Inbound requests are signature-verified (HMAC-SHA256, 5-minute freshness window) by the provider before any domain work. The server mounts `/slack/oauth/callback`, `/slack/commands/feeblo`, and `/slack/interactive`. The dashboard settings page (`/$organizationId/settings/integrations/slack`, `integrations.manage`) handles workspace connect/disconnect and per-channel notification toggles.

## Discord provider

`integrations/discord` implements the Discord provider (`discord`, OAuth 2.0):

- **`channel.notifications`** (outbound) — one route per channel; the durable delivery worker posts a `ChannelUpdateMessage` rendered into a Discord embed for every `feedback.post.created` event. Unlike Slack there is no join step: the bot's channel access is granted at install time through the OAuth permissions bitfield (View Channels, Send Messages, Embed Links, Read Message History) and may be overridden per channel by the server.
- **`interactions`** (inbound) — every interaction type arrives at the single `/discord/interactions` endpoint: the `/feeblo` slash command and the “Send to Feeblo” message context menu open the feedback modal (title, details, board select), and `MODAL_SUBMIT` creates a post (source `DISCORD`) and answers with an ephemeral confirmation. Modal metadata travels in the `custom_id` (`feeblo:<org>:<guild>:<channel>[:<message>]`) because Discord caps custom ids at 100 characters. Discord identities resolve against the user table through the stable synthetic email `discord-<guild>-<user>@discord.invalid` (`emailVerified: false`); Discord never exposes the invoking user's email to the integration, so the Slack email-linking step does not apply.

Application-wide credentials differ from Slack: the bot token and interaction public key are shared by every guild install, so they live in configuration (`DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`) like the Slack signing secret. Only the per-install OAuth artifacts (installer user token, OAuth state nonce) are encrypted at rest with `INTEGRATION_ENCRYPTION_KEY` (falling back to `AUTH_ENCRYPTION_KEY`). Connect registers the `/feeblo` and “Send to Feeblo” commands in the guild (`PUT /applications/{app}/guilds/{guild}/commands`), so they appear instantly and are scoped to the connected server.

Inbound requests are signature-verified (Ed25519, `X-Signature-Ed25519` over `X-Signature-Timestamp + body`, 5-minute freshness window) by the provider before any domain work. The server mounts `/discord/oauth/callback` and `/discord/interactions`. The dashboard settings page (`/$organizationId/settings/integrations/discord`, `integrations.manage`) handles server connect/disconnect and per-channel notification toggles.

## GitHub provider

`integrations/github` implements the GitHub provider (`github`, GitHub App, `github_app` connection mode) — the first provider to supply inbound and binding behavior:

- **`github.issue.create`** (outbound) — creating and linking GitHub issues from Feeblo posts; a created issue carries the post's title and description, and the bot comments a Feeblo backlink ("The issue is linked to our feedback platform. For feedback and updates, please visit [this link](…)") on both created and linked issues. Issues produced by a delivery are recorded as provider-neutral external-resource links on the post.
- **`github.issue.webhook`** (inbound) — the global App webhook (`/github/app/webhooks`) is signature-verified and deduplicated by GitHub delivery ID before any domain work; issue state changes map to Feeblo post statuses through organization-owned sync rules and may notify the post's upvoters.

External resources are the V1 form of bindings: `integration_external_resource` / `post_external_resource_link` (and `packages/domain`'s provider-neutral `external-resource` service) hold one-to-many links from a Feeblo post to provider-owned resources. The server mounts `/github/app/installations/callback` and `/github/app/webhooks`; installation access tokens are never stored, and the App credentials (ID, client ID/secret, private key, webhook secret) live in configuration. The dashboard settings page (`/$organizationId/settings/integrations/github`, `integrations.manage`) handles App installation and issue-sync rules; the per-post create/link actions and linked-resource panel are gated on the same `integrations.manage` permission. Sync rules are hard-wired to two shapes per connection — (any, open) sets a status when any linked issue is open, (all, closed) sets one when every linked issue is closed — at most one rule per shape and each individually disableable. The two shapes can never match the same issue aggregate, so rule application is deterministic.

Linear and HubSpot providers, bidirectional synchronization (field ownership, conflict handling, and reconciliation), and in-modal similar-request upvoting remain future phases.

## Operations

The server exports delivery backlog, claimed backlog, provider latency/outcome, lease-recovery age/count, and automatic-pause metrics. Alerting should cover sustained backlog, lease-recovery spikes, and repeated automatic pauses. Traces carry only organization, connection, route, event, correlation, delivery, and provider identifiers; payloads, endpoint URLs, signing keys, response bodies, and decrypted credentials must never be attached. Retention cleanup runs hourly and removes V1 events, deliveries, and attempts after 30 days, then purges archived endpoint metadata.
