import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../../session-middleware";
import { ChatIntegrationErrors } from "../chat/errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped Discord integration management. */
export class DiscordManagementRpcs extends RpcGroup.make(
  Rpc.make("DiscordConnectionList", {
    success: Schema.Array(S.DiscordConnection),
    payload: S.DiscordConnectionList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordConnectStart", {
    success: S.DiscordConnectStarted,
    payload: S.DiscordConnectStart,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordChannelList", {
    success: Schema.Array(S.DiscordChannel),
    payload: S.DiscordChannelList,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordChannelNotificationsUpdate", {
    success: Schema.Void,
    payload: S.DiscordChannelNotificationsUpdate,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordConnectionDisconnect", {
    success: Schema.Void,
    payload: S.DiscordConnectionDisconnect,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordIntegrationStatus", {
    success: S.DiscordIntegrationStatus,
    error: ChatIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
