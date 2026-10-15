import { makeChatManagementRpcHandlers } from "@feeblo/domain/integration/chat/rpc-handlers";
import { SlackManagementService } from "@feeblo/domain/integration/slack/management-service";
import { SlackManagementRpcs } from "@feeblo/domain/integration/slack/rpcs";
import * as Effect from "effect/Effect";

/**
 * Authenticated RPC handlers which authorize `integrations.manage` before
 * every service call.
 *
 * The authorization and plan-gate behaviour lives in the shared chat handler
 * factory; this file is the Slack naming of that record onto the Slack RPC
 * group.
 */
export const SlackManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* SlackManagementService;
  const handlers = yield* makeChatManagementRpcHandlers(service);
  return {
    ListSlackChannels: handlers.channelList,
    UpdateSlackChannelNotifications: handlers.channelNotificationsUpdate,
    StartSlackConnect: handlers.connectStart,
    DisconnectSlackConnection: handlers.connectionDisconnect,
    ListSlackConnections: handlers.connectionList,
    GetSlackIntegrationStatus: handlers.integrationStatus,
  };
});

/** RPC layer that leaves the concrete management service to server composition. */
export const SlackManagementRpcHandlers = SlackManagementRpcs.toLayer(
  SlackManagementRpcHandlersEffect
);
