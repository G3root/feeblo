import * as Effect from "effect/Effect";

import * as Policy from "../../policy";
import { DiscordManagementService } from "./management-service";
import { DiscordManagementRpcs } from "./rpcs";

/** Authenticated RPC handlers which authorize `integrations.manage` before every service call. */
export const DiscordManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* DiscordManagementService;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(
      Policy.canPermission(organizationId, "integrations.manage")
    );
  return {
    DiscordConnectionList: (
      input: Parameters<typeof service.listConnections>[0]
    ) => service.listConnections(input).pipe(authorize(input.organizationId)),
    DiscordConnectStart: (input: Parameters<typeof service.connectStart>[0]) =>
      service.connectStart(input).pipe(authorize(input.organizationId)),
    DiscordChannelList: (input: Parameters<typeof service.listChannels>[0]) =>
      service.listChannels(input).pipe(authorize(input.organizationId)),
    DiscordChannelNotificationsUpdate: (
      input: Parameters<typeof service.setChannelNotifications>[0]
    ) =>
      service
        .setChannelNotifications(input)
        .pipe(authorize(input.organizationId)),
    DiscordConnectionDisconnect: (
      input: Parameters<typeof service.disconnect>[0]
    ) => service.disconnect(input).pipe(authorize(input.organizationId)),
    DiscordIntegrationStatus: () => service.status(),
  };
});

/** RPC layer that leaves the concrete management service to server composition. */
export const DiscordManagementRpcHandlers = DiscordManagementRpcs.toLayer(
  DiscordManagementRpcHandlersEffect
);
