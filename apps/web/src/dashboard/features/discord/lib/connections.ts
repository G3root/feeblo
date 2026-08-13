import { fetchRpc } from "~/lib/runtime";

export const loadDiscordStatus = () =>
  fetchRpc((rpc) => rpc.DiscordIntegrationStatus()).then(
    (result) => result.configured
  );

export const loadConnections = (organizationId: string) =>
  fetchRpc((rpc) => rpc.DiscordConnectionList({ organizationId })).then(
    (result) => [...result]
  );

export const loadChannels = (organizationId: string, connectionId: string) =>
  fetchRpc((rpc) =>
    rpc.DiscordChannelList({ connectionId, organizationId })
  ).then((result) => [...result]);

export const startDiscordConnect = (organizationId: string) =>
  fetchRpc((rpc) => rpc.DiscordConnectStart({ organizationId }));

export const updateChannelNotifications = (input: {
  readonly channelId: string;
  readonly connectionId: string;
  readonly enabled: boolean;
  readonly organizationId: string;
}) =>
  fetchRpc((rpc) =>
    rpc.DiscordChannelNotificationsUpdate({
      channelId: input.channelId,
      connectionId: input.connectionId,
      enabled: input.enabled,
      organizationId: input.organizationId,
    })
  );

export const disconnectDiscordConnection = (input: {
  readonly connectionId: string;
  readonly organizationId: string;
}) =>
  fetchRpc((rpc) =>
    rpc.DiscordConnectionDisconnect({
      connectionId: input.connectionId,
      organizationId: input.organizationId,
    })
  );
