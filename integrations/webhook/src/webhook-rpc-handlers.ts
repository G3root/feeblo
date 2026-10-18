import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { WebhookManagementRpcs } from "@feeblo/domain/integration/rpcs";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import * as Policy from "@feeblo/domain/policy";
import { withRemapDbErrors } from "@feeblo/domain/rpc-errors";
import * as Effect from "effect/Effect";

/** Authenticated RPC handlers which authorize `webhooks.manage` before every service call. */
export const WebhookManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* WebhookManagementService;
  const entitlementPolicy = yield* EntitlementPolicy;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(Policy.canPermission(organizationId, "webhooks.manage"));
  // A locked workspace keeps its existing endpoints delivering (webhooks are
  // infrastructure on every plan), but cannot mint, rotate, or test new ones;
  // pausing and removing stay open so the owner can clean up.
  const authorizeWrite = (organizationId: string) =>
    Policy.withPolicy(
      Policy.all(
        Policy.canPermission(organizationId, "webhooks.manage"),
        entitlementPolicy
          .assertWorkspaceWritable(organizationId)
          // The lock reads the plan from the database; a driver failure here
          // is remapped so the contract's error union stays the RPC's own.
          .pipe(withRemapDbErrors("WebhookEndpoint", "update"))
      )
    );
  return {
    ListWebhookEndpoints: (
      input: Parameters<typeof service.listEndpoints>[0]
    ) => service.listEndpoints(input).pipe(authorize(input.organizationId)),
    CreateWebhookEndpoint: (
      input: Parameters<typeof service.createEndpoint>[0]
    ) =>
      service.createEndpoint(input).pipe(authorizeWrite(input.organizationId)),
    UpdateWebhookEndpoint: (
      input: Parameters<typeof service.updateEndpoint>[0]
    ) =>
      service.updateEndpoint(input).pipe(authorizeWrite(input.organizationId)),
    PauseWebhookEndpoint: (
      input: Parameters<typeof service.pauseEndpoint>[0]
    ) => service.pauseEndpoint(input).pipe(authorize(input.organizationId)),
    ResumeWebhookEndpoint: (
      input: Parameters<typeof service.resumeEndpoint>[0]
    ) =>
      service.resumeEndpoint(input).pipe(authorizeWrite(input.organizationId)),
    RemoveWebhookEndpoint: (
      input: Parameters<typeof service.removeEndpoint>[0]
    ) => service.removeEndpoint(input).pipe(authorize(input.organizationId)),
    RotateWebhookSecret: (input: Parameters<typeof service.rotateSecret>[0]) =>
      service.rotateSecret(input).pipe(authorizeWrite(input.organizationId)),
    TestWebhookDelivery: (
      input: Parameters<typeof service.sendTestDelivery>[0]
    ) =>
      service
        .sendTestDelivery(input)
        .pipe(authorizeWrite(input.organizationId)),
    GetWebhookDeliveryHistory: (
      input: Parameters<typeof service.getDeliveryHistory>[0]
    ) =>
      service.getDeliveryHistory(input).pipe(authorize(input.organizationId)),
    RetryWebhookDelivery: (
      input: Parameters<typeof service.retryDelivery>[0]
    ) =>
      service.retryDelivery(input).pipe(authorizeWrite(input.organizationId)),
  };
});

/**
 * RPC layer that intentionally leaves the concrete management service to
 * server composition.
 */
export const WebhookManagementRpcHandlers = WebhookManagementRpcs.toLayer(
  WebhookManagementRpcHandlersEffect
);
