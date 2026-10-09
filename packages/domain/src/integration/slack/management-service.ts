import * as Context from "effect/Context";

import {
  type ChatChannelServiceContract,
  type ChatConnectionServiceContract,
  type ChatManagementSchemas,
  type ChatManagementServiceContract,
} from "../chat/management-service";
import type * as S from "./schema";

/** The Slack shapes the shared chat management contract is parameterised by. */
export interface SlackManagementSchemas extends ChatManagementSchemas {
  readonly Channel: S.TSlackChannel;
  readonly ChannelList: S.TSlackChannelList;
  readonly ChannelNotificationsUpdate: S.TSlackChannelNotificationsUpdate;
  readonly Connection: S.TSlackConnection;
  readonly ConnectionDisconnect: S.TSlackConnectionDisconnect;
  readonly ConnectionList: S.TSlackConnectionList;
  readonly ConnectStarted: S.TSlackConnectStarted;
  readonly ConnectStart: S.TSlackConnectStart;
  readonly IntegrationStatus: S.TSlackIntegrationStatus;
}

/** Organization-scoped Slack management boundary; read methods never return credentials. */
export type SlackManagementServiceContract =
  ChatManagementServiceContract<SlackManagementSchemas>;

/** The connection lifecycle half of the Slack management contract. */
export type SlackConnectionServiceContract =
  ChatConnectionServiceContract<SlackManagementSchemas>;

/** The channel half of the Slack management contract. */
export type SlackChannelServiceContract =
  ChatChannelServiceContract<SlackManagementSchemas>;

/** Service key implemented by the server composition root for Slack commands. */
export class SlackManagementService extends Context.Service<
  SlackManagementService,
  SlackManagementServiceContract
>()("@feeblo/SlackManagementService") {}
