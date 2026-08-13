import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import type * as Effect from "effect/Effect";
import type { WebhookManagementError } from "./errors";
import type * as S from "./schema";

/** Organization-scoped webhook management boundary; read methods never return credentials. */
export interface WebhookManagementServiceShape {
  readonly createEndpoint: (
    input: S.TWebhookEndpointCreate
  ) => Effect.Effect<
    S.TWebhookEndpointCreated,
    WebhookManagementError,
    Crypto.Crypto
  >;
  readonly getDeliveryHistory: (
    input: S.TWebhookDeliveryHistory
  ) => Effect.Effect<S.TWebhookDeliveryHistoryPage, WebhookManagementError>;
  readonly listEndpoints: (
    input: S.TWebhookEndpointList
  ) => Effect.Effect<readonly S.TWebhookEndpoint[], WebhookManagementError>;
  readonly pauseEndpoint: (
    input: S.TWebhookConnectionAction
  ) => Effect.Effect<void, WebhookManagementError>;
  readonly removeEndpoint: (
    input: S.TWebhookConnectionAction
  ) => Effect.Effect<void, WebhookManagementError>;
  readonly resumeEndpoint: (
    input: S.TWebhookConnectionAction
  ) => Effect.Effect<void, WebhookManagementError>;
  readonly retryDelivery: (
    input: S.TWebhookManualRetry
  ) => Effect.Effect<void, WebhookManagementError>;
  readonly rotateSecret: (
    input: S.TWebhookConnectionAction
  ) => Effect.Effect<
    S.TWebhookSecretRotated,
    WebhookManagementError,
    Crypto.Crypto
  >;
  readonly sendTestDelivery: (
    input: S.TWebhookTestDelivery
  ) => Effect.Effect<S.TWebhookTestDeliveryResult, WebhookManagementError>;
  readonly updateEndpoint: (
    input: S.TWebhookEndpointUpdate
  ) => Effect.Effect<S.TWebhookEndpoint, WebhookManagementError>;
}

/** Service key implemented by the server composition root for webhook commands. */
export class WebhookManagementService extends Context.Service<
  WebhookManagementService,
  WebhookManagementServiceShape
>()("@feeblo/WebhookManagementService") {}
