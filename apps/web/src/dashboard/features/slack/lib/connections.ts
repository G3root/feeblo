import { fetchRpc } from "~/lib/runtime";

export const loadSlackStatus = () =>
  fetchRpc((rpc) => rpc.SlackIntegrationStatus()).then(
    (result) => result.configured
  );

export const loadConnections = (organizationId: string) =>
  fetchRpc((rpc) => rpc.SlackConnectionList({ organizationId })).then(
    (result) => [...result]
  );

export const loadChannels = (organizationId: string, connectionId: string) =>
  fetchRpc((rpc) =>
    rpc.SlackChannelList({ connectionId, organizationId })
  ).then((result) => [...result]);

export const startSlackConnect = (organizationId: string) =>
  fetchRpc((rpc) => rpc.SlackConnectStart({ organizationId }));

export const updateChannelNotifications = (input: {
  readonly channelId: string;
  readonly channelName: string;
  readonly connectionId: string;
  readonly enabled: boolean;
  readonly organizationId: string;
}) =>
  fetchRpc((rpc) =>
    rpc.SlackChannelNotificationsUpdate({
      channelId: input.channelId,
      channelName: input.channelName,
      connectionId: input.connectionId,
      enabled: input.enabled,
      organizationId: input.organizationId,
    })
  );

export const disconnectSlackConnection = (input: {
  readonly connectionId: string;
  readonly organizationId: string;
}) =>
  fetchRpc((rpc) =>
    rpc.SlackConnectionDisconnect({
      connectionId: input.connectionId,
      organizationId: input.organizationId,
    })
  );
