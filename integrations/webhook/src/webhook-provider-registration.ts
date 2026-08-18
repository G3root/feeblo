import {
  IntegrationPostEventData,
  type IntegrationProviderDeliveryInput,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  type IntegrationProviderRegistration,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import { classifyIntegrationHttpDeliveryStatus } from "@feeblo/integration-core/delivery-policy";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  resolveAndParseWebhookEndpoint,
  type WebhookEndpointSecurityPolicy,
} from "./webhook-endpoint-security";
import {
  WebhookConnectionConfiguration,
  WebhookRouteConfiguration,
  webhookEventsPostCapabilityKey,
  webhookProviderKey,
  webhookProviderManifest,
} from "./webhook-manifest";
import { WebhookExternalPayload } from "./webhook-payload";
import {
  signWebhookDelivery,
  type WebhookSigningKeyring,
} from "./webhook-signing";
import { sendWebhookDelivery } from "./webhook-transport";

/** Decrypted provider credentials are supplied by the composition root, never stored in core-safe records. */
export interface WebhookProviderCredentialResolver {
  readonly loadWebhookCredentials: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    {
      readonly endpointUrl: Redacted.Redacted<string>;
      readonly signingKeyring: WebhookSigningKeyring;
    },
    | IntegrationProviderInvalidConfigurationError
    | IntegrationProviderTemporaryFailure
  >;
}

/** Creates the static webhook registration with a composition-root credential resolver and freshly validated DNS per delivery. */
export const makeWebhookProviderRegistration = ({
  credentialResolver,
  endpointSecurityPolicy,
}: {
  readonly credentialResolver: WebhookProviderCredentialResolver;
  readonly endpointSecurityPolicy: WebhookEndpointSecurityPolicy;
}): IntegrationProviderRegistration => ({
  connectionConfigurationSchema: WebhookConnectionConfiguration,
  handlers: [
    {
      capabilityKey: webhookEventsPostCapabilityKey,
      deliver: (input) =>
        Effect.gen(function* () {
          const credentials =
            yield* credentialResolver.loadWebhookCredentials(input);
          const eventData = yield* Schema.decodeUnknownEffect(
            IntegrationPostEventData
          )(input.event.data).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderInvalidConfigurationError({
                  message: "Webhook event payload is invalid",
                  provider: webhookProviderKey,
                })
            )
          );
          const payload = yield* Schema.decodeUnknownEffect(
            WebhookExternalPayload
          )({
            actor: {
              type: eventData.actor.kind,
              ...(eventData.actor.memberId !== undefined && {
                memberId: eventData.actor.memberId,
              }),
              ...(eventData.actor.displayName !== undefined && {
                displayName: eventData.actor.displayName,
              }),
            },
            board: eventData.board,
            id: input.event.id,
            occurredAt: input.event.occurredAt.toString(),
            organizationId: input.event.organizationId,
            post: {
              id: eventData.post.id,
              title: eventData.post.title,
              url: eventData.post.url.toString(),
            },
            ...(eventData.previousStatus !== undefined && {
              previousStatus: eventData.previousStatus,
            }),
            status: eventData.post.status,
            type: input.event.type,
            version: input.event.version,
          }).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderInvalidConfigurationError({
                  message: "Webhook wire payload is invalid",
                  provider: webhookProviderKey,
                })
            )
          );
          const endpoint = yield* resolveAndParseWebhookEndpoint(
            Redacted.value(credentials.endpointUrl),
            endpointSecurityPolicy
          ).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderInvalidConfigurationError({
                  message: "Webhook endpoint is invalid",
                  provider: webhookProviderKey,
                })
            )
          );
          const rawBody = yield* Schema.encodeEffect(
            Schema.fromJsonString(WebhookExternalPayload)
          )(payload).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderInvalidConfigurationError({
                  message: "Webhook wire payload could not be serialized",
                  provider: webhookProviderKey,
                })
            )
          );
          // Signing is a local, transient crypto operation: a failure here is
          // retryable, not a configuration problem for the endpoint.
          const signingHeaders = yield* signWebhookDelivery({
            deliveryId: input.delivery.id,
            keyring: credentials.signingKeyring,
            rawBody,
          }).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderTemporaryFailure({
                  message: "Webhook request could not be signed",
                  provider: webhookProviderKey,
                })
            )
          );
          // The transport enforces the delivery deadline itself, so no second
          // timeout is applied here; its timeout error maps like any other
          // transport failure below.
          const response = yield* sendWebhookDelivery({
            endpoint,
            eventType: input.event.type,
            rawBody,
            signingHeaders,
          }).pipe(
            Effect.mapError((error) =>
              error.kind === "payload_too_large"
                ? new IntegrationProviderPermanentRejection({
                    message: "Webhook payload exceeds provider limit",
                    provider: webhookProviderKey,
                  })
                : new IntegrationProviderTemporaryFailure({
                    message: "Webhook transport failed",
                    provider: webhookProviderKey,
                  })
            )
          );
          const retryAfterMs =
            response.retryAfter === undefined
              ? undefined
              : Duration.toMillis(response.retryAfter);
          const outcome = classifyIntegrationHttpDeliveryStatus(
            response.status,
            retryAfterMs
          );
          if (outcome._tag === "Succeeded") {
            return { httpStatus: response.status };
          }
          if (outcome._tag === "Retry" && response.status === 429) {
            return yield* new IntegrationProviderRateLimitedError({
              httpStatus: response.status,
              message: "Webhook receiver rate limited delivery",
              provider: webhookProviderKey,
              ...(retryAfterMs === undefined ? undefined : { retryAfterMs }),
            });
          }
          if (outcome._tag === "Retry") {
            return yield* new IntegrationProviderTemporaryFailure({
              httpStatus: response.status,
              message: "Webhook receiver failed delivery",
              provider: webhookProviderKey,
            });
          }
          return yield* new IntegrationProviderPermanentRejection({
            httpStatus: response.status,
            message: "Webhook receiver rejected delivery",
            provider: webhookProviderKey,
          });
        }),
    },
  ],
  inboundHandlers: [],
  manifest: webhookProviderManifest,
  routeConfigurationSchemas: new Map([
    [webhookEventsPostCapabilityKey, WebhookRouteConfiguration],
  ]),
});
