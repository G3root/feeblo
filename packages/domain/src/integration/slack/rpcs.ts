import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../../session-middleware";
import { ChatIntegrationErrors } from "../chat/errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped Slack integration management. */
export class SlackManagementRpcs extends RpcGroup.make(
  Rpc.make("ListSlackConnections", {
    success: Schema.Array(S.SlackConnection),
    payload: S.SlackConnectionList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("StartSlackConnect", {
    success: S.SlackConnectStarted,
    payload: S.SlackConnectStart,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListSlackChannels", {
    success: Schema.Array(S.SlackChannel),
    payload: S.SlackChannelList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateSlackChannelNotifications", {
    success: Schema.Void,
    payload: S.SlackChannelNotificationsUpdate,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DisconnectSlackConnection", {
    success: Schema.Void,
    payload: S.SlackConnectionDisconnect,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("GetSlackIntegrationStatus", {
    success: S.SlackIntegrationStatus,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
