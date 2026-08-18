import * as Effect from "effect/Effect";

import * as Policy from "../../policy";
import { SlackManagementService } from "./management-service";
import { SlackManagementRpcs } from "./rpcs";

/** Authenticated RPC handlers which authorize `integrations.manage` before every service call. */
export const SlackManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* SlackManagementService;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(
      Policy.canPermission(organizationId, "integrations.manage")
    );
  return {
    SlackConnectionList: (
      input: Parameters<typeof service.listConnections>[0]
    ) => service.listConnections(input).pipe(authorize(input.organizationId)),
    SlackConnectStart: (input: Parameters<typeof service.connectStart>[0]) =>
      service.connectStart(input).pipe(authorize(input.organizationId)),
    SlackChannelList: (input: Parameters<typeof service.listChannels>[0]) =>
      service.listChannels(input).pipe(authorize(input.organizationId)),
    SlackChannelNotificationsUpdate: (
      input: Parameters<typeof service.setChannelNotifications>[0]
    ) =>
      service
        .setChannelNotifications(input)
        .pipe(authorize(input.organizationId)),
    SlackConnectionDisconnect: (
      input: Parameters<typeof service.disconnect>[0]
    ) => service.disconnect(input).pipe(authorize(input.organizationId)),
    SlackIntegrationStatus: () => service.status(),
  };
});

/** RPC layer that leaves the concrete management service to server composition. */
export const SlackManagementRpcHandlers = SlackManagementRpcs.toLayer(
  SlackManagementRpcHandlersEffect
);
