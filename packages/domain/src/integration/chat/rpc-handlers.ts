import * as Effect from "effect/Effect";

import { EntitlementPolicy } from "../../entitlement/policies";
import * as Policy from "../../policy";
import { withRemapDbErrors } from "../../rpc-errors";
import type {
  ChatManagementSchemas,
  ChatManagementServiceContract,
} from "./management-service";

/**
 * The authorization every chat management operation shares, bound to one
 * provider's management service.
 *
 * The record is provider-neutral; each provider's `*-rpc-handlers.ts` maps
 * these entries onto its own RPC method names, which is the only part that
 * differs between providers. `connectStart` additionally requires the plan's
 * integrations capability — existing connections stay manageable, so a
 * downgraded workspace can still disconnect.
 */
export const makeChatManagementRpcHandlers = <S extends ChatManagementSchemas>(
  service: ChatManagementServiceContract<S>
) =>
  Effect.gen(function* () {
    const entitlementPolicy = yield* EntitlementPolicy;
    const authorize = (organizationId: string) =>
      Policy.withPolicy(
        Policy.canPermission(organizationId, "integrations.manage")
      );

    return {
      channelList: (input: Parameters<typeof service.listChannels>[0]) =>
        service.listChannels(input).pipe(authorize(input.organizationId)),
      channelNotificationsUpdate: (
        input: Parameters<typeof service.setChannelNotifications>[0]
      ) =>
        service
          .setChannelNotifications(input)
          .pipe(authorize(input.organizationId)),
      connectStart: (input: Parameters<typeof service.connectStart>[0]) =>
        Effect.gen(function* () {
          yield* entitlementPolicy.canUseIntegrations(input.organizationId);
          return yield* service.connectStart(input);
        }).pipe(
          authorize(input.organizationId),
          withRemapDbErrors("Integration", "select")
        ),
      connectionDisconnect: (input: Parameters<typeof service.disconnect>[0]) =>
        service.disconnect(input).pipe(authorize(input.organizationId)),
      connectionList: (input: Parameters<typeof service.listConnections>[0]) =>
        service.listConnections(input).pipe(authorize(input.organizationId)),
      integrationStatus: () => service.status,
    };
  });
