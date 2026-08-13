import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { AuthMiddleware } from "../../session-middleware";
import { DiscordIntegrationErrors } from "./errors";
import * as S from "./schema";

/** Authenticated RPC surface for organization-scoped Discord integration management. */
export class DiscordManagementRpcs extends RpcGroup.make(
  Rpc.make("DiscordConnectionList", {
    success: Schema.Array(S.DiscordConnection),
    payload: S.DiscordConnectionList,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordConnectStart", {
    success: S.DiscordConnectStarted,
    payload: S.DiscordConnectStart,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordChannelList", {
    success: Schema.Array(S.DiscordChannel),
    payload: S.DiscordChannelList,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordChannelNotificationsUpdate", {
    success: Schema.Void,
    payload: S.DiscordChannelNotificationsUpdate,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordConnectionDisconnect", {
    success: Schema.Void,
    payload: S.DiscordConnectionDisconnect,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DiscordIntegrationStatus", {
    success: S.DiscordIntegrationStatus,
    error: DiscordIntegrationErrors,
  }).middleware(AuthMiddleware)
) {}
