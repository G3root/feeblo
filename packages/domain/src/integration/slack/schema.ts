import { IntegrationConnectionLifecycleStatus } from "@feeblo/db/validation-schema/integration";
import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import * as Schema from "effect/Schema";

/** Safe Slack connection summary; credentials never cross this boundary. */
export const SlackConnection = Schema.Struct({
  id: IntegrationConnectionId.schema,
  teamId: Schema.NullOr(Schema.String),
  teamName: Schema.String,
  lifecycle: IntegrationConnectionLifecycleStatus,
  createdAt: Schema.DateFromString,
});
export type TSlackConnection = typeof SlackConnection.Type;

/** List connections scoped to one organization. */
export const SlackConnectionList = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TSlackConnectionList = typeof SlackConnectionList.Type;

/** Starts the OAuth install flow and returns the Slack authorize URL. */
export const SlackConnectStart = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TSlackConnectStart = typeof SlackConnectStart.Type;

export const SlackConnectStarted = Schema.Struct({
  authorizeUrl: Schema.URLFromString,
});
export type TSlackConnectStarted = typeof SlackConnectStarted.Type;

/** One Slack channel the bot can post into, with its notification state. */
export const SlackChannel = Schema.Struct({
  id: Schema.String,
  /** True when the bot is already a member; private channels require membership. */
  isMember: Schema.Boolean,
  /** True for private channels (Slack ids starting with `G`); the bot cannot auto-join them. */
  isPrivate: Schema.Boolean,
  name: Schema.String,
  /** True when a `channel.notifications` route already exists for this channel. */
  notificationsEnabled: Schema.Boolean,
});
export type TSlackChannel = typeof SlackChannel.Type;

/** Lists channels the bot belongs to for one connection. */
export const SlackChannelList = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  organizationId: WorkspaceId.schema,
});
export type TSlackChannelList = typeof SlackChannelList.Type;

/** Toggles new-post notifications for one channel of one connection. */
export const SlackChannelNotificationsUpdate = Schema.Struct({
  channelId: Schema.String,
  /** Display name of the channel, stored on the notification route. */
  channelName: Schema.String,
  connectionId: IntegrationConnectionId.schema,
  enabled: Schema.Boolean,
  organizationId: WorkspaceId.schema,
});
export type TSlackChannelNotificationsUpdate =
  typeof SlackChannelNotificationsUpdate.Type;

/** Disconnects a Slack workspace connection and erases its credentials. */
export const SlackConnectionDisconnect = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  organizationId: WorkspaceId.schema,
});
export type TSlackConnectionDisconnect = typeof SlackConnectionDisconnect.Type;
