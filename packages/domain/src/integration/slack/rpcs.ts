import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../../session-middleware";
import { ChatIntegrationErrors } from "../chat/errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped Slack integration management. */
export class SlackManagementRpcs extends RpcGroup.make(
  Rpc.make("SlackConnectionList", {
    success: Schema.Array(S.SlackConnection),
    payload: S.SlackConnectionList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackConnectStart", {
    success: S.SlackConnectStarted,
    payload: S.SlackConnectStart,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackChannelList", {
    success: Schema.Array(S.SlackChannel),
    payload: S.SlackChannelList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackChannelNotificationsUpdate", {
    success: Schema.Void,
    payload: S.SlackChannelNotificationsUpdate,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackConnectionDisconnect", {
    success: Schema.Void,
    payload: S.SlackConnectionDisconnect,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackIntegrationStatus", {
    success: S.SlackIntegrationStatus,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
