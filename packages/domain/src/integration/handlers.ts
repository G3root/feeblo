import * as Effect from "effect/Effect";
import * as Policy from "../policy";
import { WebhookManagementRpcs } from "./rpcs";
import { WebhookManagementService } from "./webhook-management-service";

/** Authenticated RPC handlers which authorize webhooks.manage before every service call. */
export const WebhookManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* WebhookManagementService;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(Policy.canPermission(organizationId, "webhooks.manage"));
  return {
    WebhookEndpointList: (input: Parameters<typeof service.listEndpoints>[0]) =>
      service.listEndpoints(input).pipe(authorize(input.organizationId)),
    WebhookEndpointCreate: (
      input: Parameters<typeof service.createEndpoint>[0]
    ) => service.createEndpoint(input).pipe(authorize(input.organizationId)),
    WebhookEndpointUpdate: (
      input: Parameters<typeof service.updateEndpoint>[0]
    ) => service.updateEndpoint(input).pipe(authorize(input.organizationId)),
    WebhookEndpointPause: (
      input: Parameters<typeof service.pauseEndpoint>[0]
    ) => service.pauseEndpoint(input).pipe(authorize(input.organizationId)),
    WebhookEndpointResume: (
      input: Parameters<typeof service.resumeEndpoint>[0]
    ) => service.resumeEndpoint(input).pipe(authorize(input.organizationId)),
    WebhookEndpointRemove: (
      input: Parameters<typeof service.removeEndpoint>[0]
    ) => service.removeEndpoint(input).pipe(authorize(input.organizationId)),
    WebhookSecretRotate: (input: Parameters<typeof service.rotateSecret>[0]) =>
      service.rotateSecret(input).pipe(authorize(input.organizationId)),
    WebhookTestDelivery: (
      input: Parameters<typeof service.sendTestDelivery>[0]
    ) => service.sendTestDelivery(input).pipe(authorize(input.organizationId)),
    WebhookDeliveryHistory: (
      input: Parameters<typeof service.getDeliveryHistory>[0]
    ) =>
      service.getDeliveryHistory(input).pipe(authorize(input.organizationId)),
    WebhookDeliveryRetry: (
      input: Parameters<typeof service.retryDelivery>[0]
    ) => service.retryDelivery(input).pipe(authorize(input.organizationId)),
  };
});

/** RPC layer intentionally leaves the concrete management service to server composition. */
export const WebhookManagementRpcHandlers = WebhookManagementRpcs.toLayer(
  WebhookManagementRpcHandlersEffect
);
