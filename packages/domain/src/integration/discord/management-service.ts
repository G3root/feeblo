import * as Context from "effect/Context";

import {
  type ChatChannelServiceContract,
  type ChatConnectionServiceContract,
  type ChatManagementSchemas,
  type ChatManagementServiceContract,
} from "../chat/management-service";
import type * as S from "./schema";

/** The Discord shapes the shared chat management contract is parameterised by. */
export interface DiscordManagementSchemas extends ChatManagementSchemas {
  readonly Channel: S.TDiscordChannel;
  readonly ChannelList: S.TDiscordChannelList;
  readonly ChannelNotificationsUpdate: S.TDiscordChannelNotificationsUpdate;
  readonly Connection: S.TDiscordConnection;
  readonly ConnectionDisconnect: S.TDiscordConnectionDisconnect;
  readonly ConnectionList: S.TDiscordConnectionList;
  readonly ConnectStarted: S.TDiscordConnectStarted;
  readonly ConnectStart: S.TDiscordConnectStart;
  readonly IntegrationStatus: S.TDiscordIntegrationStatus;
}

/** Organization-scoped Discord management boundary; read methods never return credentials. */
export type DiscordManagementServiceContract =
  ChatManagementServiceContract<DiscordManagementSchemas>;

/** The connection lifecycle half of the Discord management contract. */
export type DiscordConnectionServiceContract =
  ChatConnectionServiceContract<DiscordManagementSchemas>;

/** The channel half of the Discord management contract. */
export type DiscordChannelServiceContract =
  ChatChannelServiceContract<DiscordManagementSchemas>;

/** Service key implemented by the server composition root for Discord commands. */
export class DiscordManagementService extends Context.Service<
  DiscordManagementService,
  DiscordManagementServiceContract
>()("@feeblo/DiscordManagementService") {}
