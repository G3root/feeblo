import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../session-middleware";
import { WebhookManagementErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped webhook management. */
export class WebhookManagementRpcs extends RpcGroup.make(
  Rpc.make("WebhookEndpointList", {
    success: Schema.Array(S.WebhookEndpoint),
    payload: S.WebhookEndpointList,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookEndpointCreate", {
    success: S.WebhookEndpointCreated,
    payload: S.WebhookEndpointCreate,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookEndpointUpdate", {
    success: S.WebhookEndpoint,
    payload: S.WebhookEndpointUpdate,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookEndpointPause", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookEndpointResume", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookEndpointRemove", {
    success: Schema.Void,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookSecretRotate", {
    success: S.WebhookSecretRotated,
    payload: S.WebhookConnectionAction,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookTestDelivery", {
    success: S.WebhookTestDeliveryResult,
    payload: S.WebhookTestDelivery,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookDeliveryHistory", {
    success: S.WebhookDeliveryHistoryPage,
    payload: S.WebhookDeliveryHistory,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("WebhookDeliveryRetry", {
    success: Schema.Void,
    payload: S.WebhookManualRetry,
    error: WebhookManagementErrors,
  }).middleware(AuthMiddleware)
) {}
