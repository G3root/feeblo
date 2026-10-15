import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { WebhookManagementErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped webhook management. */
export class WebhookManagementRpcs extends RpcGroup.make(
  Rpc.make("ListWebhookEndpoints", {
    success: Schema.Array(S.WebhookEndpoint),
    payload: S.WebhookEndpointList,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateWebhookEndpoint", {
    success: S.WebhookEndpointCreated,
    payload: S.WebhookEndpointCreate,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateWebhookEndpoint", {
    success: S.WebhookEndpoint,
    payload: S.WebhookEndpointUpdate,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PauseWebhookEndpoint", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ResumeWebhookEndpoint", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RemoveWebhookEndpoint", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RotateWebhookSecret", {
    success: S.WebhookSecretRotated,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("TestWebhookDelivery", {
    success: S.WebhookTestDeliveryResult,
    payload: S.WebhookTestDelivery,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetWebhookDeliveryHistory", {
    success: S.WebhookDeliveryHistoryPage,
    payload: S.WebhookDeliveryHistory,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("RetryWebhookDelivery", {
    success: Schema.Void,
    payload: S.WebhookManualRetry,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware)
) {}
