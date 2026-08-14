/** Browser-safe Discord capability metadata; this module imports no Node APIs. */
import {
  IntegrationCapabilityKey,
  IntegrationProviderKey,
  IntegrationProviderManifest,
} from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** Provider key owned by the Discord adapter, outside the provider-neutral kernel. */
export const discordProviderKey = IntegrationProviderKey.make("discord");
export const discordChannelNotificationsCapabilityKey =
  IntegrationCapabilityKey.make("channel.notifications");
export const discordInteractionsCapabilityKey =
  IntegrationCapabilityKey.make("interactions");

/** Discord OAuth scopes requested during server installation. */
export const DISCORD_OAUTH_SCOPES = [
  // Identify the installer so the connection records who added the bot.
  "identify",
  // Registers `/feeblo` and the "Send to Feeblo" context menu in the guild.
  "applications.commands",
  // Adds the bot to the guild the user selects during install.
  "bot",
] as const;

/**
 * Base bot permissions requested during install. Discord servers can still
 * override these per channel; the dashboard lists channels regardless and the
 * delivery worker surfaces permission failures through the typed failure
 * algebra.
 *
 *   View Channels (1 << 10) | Send Messages (1 << 11) |
 *   Embed Links (1 << 14) | Read Message History (1 << 16)
 */
export const DISCORD_OAUTH_PERMISSIONS = 84_992;

/**
 * Guild commands registered on connect (`PUT /applications/{app}/guilds/{guild}/commands`).
 * Guild-scoped commands appear instantly, unlike global commands which can
 * take up to an hour to propagate — the right fit for a per-organization
 * install model.
 */
export const DISCORD_GUILD_COMMANDS = [
  {
    name: "feeblo",
    type: 1,
    description: "Send feedback to Feeblo",
    options: [
      {
        type: 3,
        name: "text",
        description: "Your feedback (optional)",
        required: false,
      },
    ],
  },
  {
    name: "Send to Feeblo",
    // Message context menu (Discord type 3); context menus have no
    // description or options, and their names may contain spaces.
    type: 3,
  },
] as const;

/** Discord text channel types the bot can post notifications into. */
export const DISCORD_NOTIFICATION_CHANNEL_TYPES = [0, 5] as const;

/**
 * Browser-safe connection form data. Discord connections are created through
 * OAuth (never a form), so the connection configuration is an empty record;
 * it exists to satisfy the provider contract.
 */
export const DiscordConnectionConfiguration = Schema.Struct({});

/**
 * Browser-safe route configuration for the `channel.notifications`
 * capability: the Discord text channel the bot posts new-post updates into.
 */
export const DiscordChannelNotificationRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  channelId: Schema.NonEmptyString,
});
export type DiscordChannelNotificationRouteConfiguration = Schema.Schema.Type<
  typeof DiscordChannelNotificationRouteConfiguration
>;

/** Browser-safe route configuration for the inbound Discord capability; nothing to configure. */
export const DiscordInboundRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
});

/** Browser-safe Discord provider manifest consumed by management UI and registry composition. */
export const discordProviderManifest = IntegrationProviderManifest.make({
  provider: discordProviderKey,
  displayName: "Discord",
  connectionMode: "oauth2",
  capabilities: [
    {
      key: discordChannelNotificationsCapabilityKey,
      direction: "outbound",
      configVersion: 1,
    },
    {
      key: discordInteractionsCapabilityKey,
      direction: "inbound",
      configVersion: 1,
    },
  ],
});

export type DiscordConnectionConfiguration = Schema.Schema.Type<
  typeof DiscordConnectionConfiguration
>;
export type DiscordInboundRouteConfiguration = Schema.Schema.Type<
  typeof DiscordInboundRouteConfiguration
>;
