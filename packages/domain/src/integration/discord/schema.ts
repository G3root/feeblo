import { IntegrationConnectionLifecycleStatus } from "@feeblo/db/validation-schema/integration";
import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import * as Schema from "effect/Schema";

/** Safe Discord connection summary; credentials never cross this boundary. */
export const DiscordConnection = Schema.Struct({
  id: IntegrationConnectionId.schema,
  guildId: Schema.NullOr(Schema.String),
  guildName: Schema.String,
  lifecycle: IntegrationConnectionLifecycleStatus,
  createdAt: Schema.DateFromString,
});
export type TDiscordConnection = typeof DiscordConnection.Type;

/** List connections scoped to one organization. */
export const DiscordConnectionList = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TDiscordConnectionList = typeof DiscordConnectionList.Type;

/** Starts the OAuth install flow and returns the Discord authorize URL. */
export const DiscordConnectStart = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TDiscordConnectStart = typeof DiscordConnectStart.Type;

export const DiscordConnectStarted = Schema.Struct({
  authorizeUrl: Schema.URLFromString,
});
export type TDiscordConnectStarted = typeof DiscordConnectStarted.Type;

/** Whether the Discord integration is configured for this deployment. */
export const DiscordIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
});
export type TDiscordIntegrationStatus = typeof DiscordIntegrationStatus.Type;

/** One Discord text channel the bot can post into, with its notification state. */
export const DiscordChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** True when a `channel.notifications` route already exists for this channel. */
  notificationsEnabled: Schema.Boolean,
});
export type TDiscordChannel = typeof DiscordChannel.Type;

/** Lists channels of one guild for one connection. */
export const DiscordChannelList = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  organizationId: WorkspaceId.schema,
});
export type TDiscordChannelList = typeof DiscordChannelList.Type;

/** Toggles new-post notifications for one channel of one connection. */
export const DiscordChannelNotificationsUpdate = Schema.Struct({
  channelId: Schema.String,
  /** Display name of the channel, stored on the notification route. */
  channelName: Schema.String,
  connectionId: IntegrationConnectionId.schema,
  enabled: Schema.Boolean,
  organizationId: WorkspaceId.schema,
});
export type TDiscordChannelNotificationsUpdate =
  typeof DiscordChannelNotificationsUpdate.Type;

/** Disconnects a Discord guild connection and erases its credentials. */
export const DiscordConnectionDisconnect = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  organizationId: WorkspaceId.schema,
});
export type TDiscordConnectionDisconnect =
  typeof DiscordConnectionDisconnect.Type;
