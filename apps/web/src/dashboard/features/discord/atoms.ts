import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

export type DiscordConnection = Atom.Success<
  ReturnType<typeof connectionsAtom>
>[number];
export type DiscordChannel = Atom.Success<
  ReturnType<typeof channelsAtom>
>[number];

export const discordReactivityKeys = (organizationId: string) => ({
  discord: [organizationId],
});

/** Discord connections of one organization, cached per organization id. */
export const connectionsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "DiscordConnectionList",
    { organizationId },
    { reactivityKeys: discordReactivityKeys(organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type ChannelListArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/** Channels of one connection, cached per organization and connection id. */
export const channelsAtom = Atom.family((args: ChannelListArgs) =>
  DashboardClient.query(
    "DiscordChannelList",
    { connectionId: args.connectionId, organizationId: args.organizationId },
    { reactivityKeys: discordReactivityKeys(args.organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

/** Whether Discord is configured for this deployment. */
export const discordStatusAtom = DashboardClient.query(
  "DiscordIntegrationStatus",
  void 0
).pipe(
  Atom.map((result) => Result.map(result, (value) => value.configured)),
  dashboardSWR("30 seconds"),
  Atom.setIdleTTL("5 minutes")
);

export const startDiscordConnectAtom = DashboardClient.mutation(
  "DiscordConnectStart"
);
export const updateDiscordChannelNotificationsAtom = DashboardClient.mutation(
  "DiscordChannelNotificationsUpdate"
);
export const disconnectDiscordConnectionAtom = DashboardClient.mutation(
  "DiscordConnectionDisconnect"
);
