import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

export type SlackConnection = Atom.Success<
  ReturnType<typeof connectionsAtom>
>[number];
export type SlackChannel = Atom.Success<
  ReturnType<typeof channelsAtom>
>[number];

export const slackReactivityKeys = (organizationId: string) => ({
  slack: [organizationId],
});

/** Slack connections of one organization, cached per organization id. */
export const connectionsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "SlackConnectionList",
    { organizationId },
    { reactivityKeys: slackReactivityKeys(organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type ChannelListArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/** Channels of one connection, cached per organization and connection id. */
export const channelsAtom = Atom.family((args: ChannelListArgs) =>
  DashboardClient.query(
    "SlackChannelList",
    { connectionId: args.connectionId, organizationId: args.organizationId },
    { reactivityKeys: slackReactivityKeys(args.organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

/** Whether Slack is configured for this deployment. */
export const slackStatusAtom = DashboardClient.query(
  "SlackIntegrationStatus",
  void 0
).pipe(
  Atom.map((result) => Result.map(result, (value) => value.configured)),
  dashboardSWR("30 seconds"),
  Atom.setIdleTTL("5 minutes")
);

export const startSlackConnectAtom =
  DashboardClient.mutation("SlackConnectStart");
export const updateSlackChannelNotificationsAtom = DashboardClient.mutation(
  "SlackChannelNotificationsUpdate"
);
export const disconnectSlackConnectionAtom = DashboardClient.mutation(
  "SlackConnectionDisconnect"
);
