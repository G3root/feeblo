import { withProviderAudit } from "@feeblo/domain/integration/audit";
import { WebhookManagementRpcs } from "@feeblo/domain/integration/rpcs";
import { WebhookManagementService } from "@feeblo/domain/integration/webhook-management-service";
import * as Policy from "@feeblo/domain/policy";
import * as Effect from "effect/Effect";

/**
 * Authenticated RPC handlers which authorize `webhooks.manage` before every
 * service call.
 *
 * The six configuration actions run with the operator in context, so the
 * service writes its audit entry inside the transaction that changes the
 * endpoint. `TestWebhookDelivery`, `GetWebhookDeliveryHistory` and
 * `RetryWebhookDelivery` are delivery operations rather than configuration and
 * are deliberately not audited: a retry is the product retrying, and
 * `docs/audit-log.md` keeps delivery attempts out of the log.
 */
export const WebhookManagementRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* WebhookManagementService;
  const authorize = (organizationId: string) =>
    Policy.withPolicy(Policy.canPermission(organizationId, "webhooks.manage"));
  return {
    ListWebhookEndpoints: (
      input: Parameters<typeof service.listEndpoints>[0]
    ) => service.listEndpoints(input).pipe(authorize(input.organizationId)),
    CreateWebhookEndpoint: (
      input: Parameters<typeof service.createEndpoint>[0]
    ) =>
      withProviderAudit(
        input.organizationId,
        service.createEndpoint(input)
      ).pipe(authorize(input.organizationId)),
    UpdateWebhookEndpoint: (
      input: Parameters<typeof service.updateEndpoint>[0]
    ) =>
      withProviderAudit(
        input.organizationId,
        service.updateEndpoint(input)
      ).pipe(authorize(input.organizationId)),
    PauseWebhookEndpoint: (
      input: Parameters<typeof service.pauseEndpoint>[0]
    ) =>
      withProviderAudit(
        input.organizationId,
        service.pauseEndpoint(input)
      ).pipe(authorize(input.organizationId)),
    ResumeWebhookEndpoint: (
      input: Parameters<typeof service.resumeEndpoint>[0]
    ) =>
      withProviderAudit(
        input.organizationId,
        service.resumeEndpoint(input)
      ).pipe(authorize(input.organizationId)),
    RemoveWebhookEndpoint: (
      input: Parameters<typeof service.removeEndpoint>[0]
    ) =>
      withProviderAudit(
        input.organizationId,
        service.removeEndpoint(input)
      ).pipe(authorize(input.organizationId)),
    RotateWebhookSecret: (input: Parameters<typeof service.rotateSecret>[0]) =>
      withProviderAudit(input.organizationId, service.rotateSecret(input)).pipe(
        authorize(input.organizationId)
      ),
    TestWebhookDelivery: (
      input: Parameters<typeof service.sendTestDelivery>[0]
    ) => service.sendTestDelivery(input).pipe(authorize(input.organizationId)),
    GetWebhookDeliveryHistory: (
      input: Parameters<typeof service.getDeliveryHistory>[0]
    ) =>
      service.getDeliveryHistory(input).pipe(authorize(input.organizationId)),
    RetryWebhookDelivery: (
      input: Parameters<typeof service.retryDelivery>[0]
    ) => service.retryDelivery(input).pipe(authorize(input.organizationId)),
  };
});

/**
 * RPC layer that intentionally leaves the concrete management service to
 * server composition.
 */
export const WebhookManagementRpcHandlers = WebhookManagementRpcs.toLayer(
  WebhookManagementRpcHandlersEffect
);
