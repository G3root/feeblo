/** Browser-safe Slack capability metadata; this module imports no Node APIs. */
import {
  IntegrationCapabilityKey,
  IntegrationProviderKey,
  IntegrationProviderManifest,
} from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** Provider key owned by the Slack adapter, outside the provider-neutral kernel. */
export const slackProviderKey = IntegrationProviderKey.make("slack");

/** Browser-safe provider key for the Slack integration provider. */
export const SlackProviderKey = Schema.Literal("slack");

/** Slack OAuth scopes requested during workspace installation. */
/** Slack OAuth scopes requested during workspace installation. */
export const SLACK_OAUTH_SCOPES = [
  "chat:write",
  "commands",
  "users:read",
  "users:read.email",
  "channels:read",
  "groups:read",
  "team:read",
  // Lets the bot join public channels automatically so notifications work
  // without a member having to add the bot manually.
  "channels:join",
] as const;

/**
 * Browser-safe connection form data. Slack connections are created through
 * OAuth (never a form), so the connection configuration is an empty record;
 * it exists to satisfy the provider contract.
 */
export const SlackConnectionConfiguration = Schema.Struct({});

/**
 * Browser-safe route configuration for the `channel.notifications`
 * capability: the Slack channel the bot posts new-post updates into.
 */
export const SlackChannelNotificationRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  channelId: Schema.NonEmptyString,
  channelName: Schema.NonEmptyString,
});
export type SlackChannelNotificationRouteConfiguration = Schema.Schema.Type<
  typeof SlackChannelNotificationRouteConfiguration
>;

/** Browser-safe route configuration for inbound Slack capabilities; nothing to configure. */
export const SlackInboundRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
});

/** Browser-safe Slack provider manifest consumed by management UI and registry composition. */
export const slackProviderManifest = IntegrationProviderManifest.make({
  provider: slackProviderKey,
  displayName: "Slack",
  connectionMode: "oauth2",
  capabilities: [
    {
      key: IntegrationCapabilityKey.make("channel.notifications"),
      direction: "outbound",
      configVersion: 1,
    },
    {
      key: IntegrationCapabilityKey.make("commands"),
      direction: "inbound",
      configVersion: 1,
    },
    {
      key: IntegrationCapabilityKey.make("message.action"),
      direction: "inbound",
      configVersion: 1,
    },
  ],
});

export type SlackConnectionConfiguration = Schema.Schema.Type<
  typeof SlackConnectionConfiguration
>;
export type SlackInboundRouteConfiguration = Schema.Schema.Type<
  typeof SlackInboundRouteConfiguration
>;
