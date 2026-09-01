import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { DiscordManagementService } from "@feeblo/domain/integration/discord/management-service";
import { DiscordManagementRpcs } from "@feeblo/domain/integration/discord/rpcs";
import * as Policy from "@feeblo/domain/policy";
import { withRemapDbErrors } from "@feeblo/domain/rpc-errors";
import * as Effect from "effect/Effect";

/** Authenticated RPC handlers which authorize `integrations.manage` before every service call. */
export const DiscordManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* DiscordManagementService;
  const entitlementPolicy = yield* EntitlementPolicy;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(
      Policy.canPermission(organizationId, "integrations.manage")
    );
  return {
    DiscordConnectionList: (
      input: Parameters<typeof service.listConnections>[0]
    ) => service.listConnections(input).pipe(authorize(input.organizationId)),
    DiscordConnectStart: (input: Parameters<typeof service.connectStart>[0]) =>
      Effect.gen(function* () {
        // Starting a connection additionally requires the plan's integrations capability.
        yield* entitlementPolicy.canUseIntegrations(input.organizationId);
        return yield* service.connectStart(input);
      }).pipe(
        authorize(input.organizationId),
        withRemapDbErrors("Integration", "select")
      ),
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
