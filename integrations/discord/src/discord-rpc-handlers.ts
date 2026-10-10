import { makeChatManagementRpcHandlers } from "@feeblo/domain/integration/chat/rpc-handlers";
import { DiscordManagementService } from "@feeblo/domain/integration/discord/management-service";
import { DiscordManagementRpcs } from "@feeblo/domain/integration/discord/rpcs";
import * as Effect from "effect/Effect";

/**
 * Authenticated RPC handlers which authorize `integrations.manage` before
 * every service call.
 *
 * The authorization and plan-gate behaviour lives in the shared chat handler
 * factory; this file is the Discord naming of that record onto the Discord RPC
 * group.
 */
export const DiscordManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* DiscordManagementService;
  const handlers = yield* makeChatManagementRpcHandlers(service);
  return {
    DiscordChannelList: handlers.channelList,
    DiscordChannelNotificationsUpdate: handlers.channelNotificationsUpdate,
    DiscordConnectStart: handlers.connectStart,
    DiscordConnectionDisconnect: handlers.connectionDisconnect,
    DiscordConnectionList: handlers.connectionList,
    DiscordIntegrationStatus: handlers.integrationStatus,
  };
});

/** RPC layer that leaves the concrete management service to server composition. */
export const DiscordManagementRpcHandlers = DiscordManagementRpcs.toLayer(
  DiscordManagementRpcHandlersEffect
);
