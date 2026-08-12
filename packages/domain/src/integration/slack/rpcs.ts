import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../../session-middleware";
import { SlackIntegrationErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped Slack integration management. */
export class SlackManagementRpcs extends RpcGroup.make(
  Rpc.make("SlackConnectionList", {
    success: Schema.Array(S.SlackConnection),
    payload: S.SlackConnectionList,
    error: SlackIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackConnectStart", {
    success: S.SlackConnectStarted,
    payload: S.SlackConnectStart,
    error: SlackIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackChannelList", {
    success: Schema.Array(S.SlackChannel),
    payload: S.SlackChannelList,
    error: SlackIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackChannelNotificationsUpdate", {
    success: Schema.Void,
    payload: S.SlackChannelNotificationsUpdate,
    error: SlackIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("SlackConnectionDisconnect", {
    success: Schema.Void,
    payload: S.SlackConnectionDisconnect,
    error: SlackIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
