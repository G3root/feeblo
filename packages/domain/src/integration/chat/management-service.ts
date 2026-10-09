import * as Effect from "effect/Effect";

import type { ChatIntegrationError } from "./errors";

/**
 * The schema-shaped parts of a chat management contract.
 *
 * Slack and Discord publish different connection and channel shapes, so the
 * contract below is parameterised by them while the method shape itself is one
 * shape for both providers. A provider declares its bundle once, in its own
 * `management-service.ts`, and every shared helper reads the contract through
 * it. Every management payload carries `organizationId`; that is the field the
 * shared handler factory authorizes on.
 */
export interface ChatManagementSchemas {
  readonly Channel: unknown;
  readonly ChannelList: { readonly organizationId: string };
  readonly ChannelNotificationsUpdate: { readonly organizationId: string };
  readonly Connection: unknown;
  readonly ConnectionDisconnect: { readonly organizationId: string };
  readonly ConnectionList: { readonly organizationId: string };
  readonly ConnectStarted: unknown;
  readonly ConnectStart: { readonly organizationId: string };
  readonly IntegrationStatus: unknown;
}

/** Organization-scoped chat management boundary; read methods never return credentials. */
export interface ChatManagementServiceContract<
  S extends ChatManagementSchemas,
> {
  /** Completes the OAuth handshake; called by the server callback route. */
  readonly connectComplete: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<
    { readonly organizationId: string },
    ChatIntegrationError
  >;
  readonly connectStart: (
    input: S["ConnectStart"]
  ) => Effect.Effect<S["ConnectStarted"], ChatIntegrationError>;
  readonly disconnect: (
    input: S["ConnectionDisconnect"]
  ) => Effect.Effect<void, ChatIntegrationError>;
  readonly listChannels: (
    input: S["ChannelList"]
  ) => Effect.Effect<readonly S["Channel"][], ChatIntegrationError>;
  readonly listConnections: (
    input: S["ConnectionList"]
  ) => Effect.Effect<readonly S["Connection"][], ChatIntegrationError>;
  readonly setChannelNotifications: (
    input: S["ChannelNotificationsUpdate"]
  ) => Effect.Effect<void, ChatIntegrationError>;
  /** Reports whether this provider is configured for the deployment. */
  readonly status: Effect.Effect<S["IntegrationStatus"], never>;
}

/** The connection lifecycle half of a chat management contract. */
export type ChatConnectionServiceContract<S extends ChatManagementSchemas> =
  Pick<
    ChatManagementServiceContract<S>,
    "connectComplete" | "connectStart" | "disconnect" | "listConnections"
  >;

/** The channel half of a chat management contract. */
export type ChatChannelServiceContract<S extends ChatManagementSchemas> = Pick<
  ChatManagementServiceContract<S>,
  "listChannels" | "setChannelNotifications"
>;

/**
 * The management service's methods, forwarded from the two services that
 * implement them.
 *
 * Both providers compose the same record; only the tags they read it from and
 * their layer wiring differ, so the forwarding lives here and each provider's
 * `management-live.ts` keeps its own layer.
 */
export const chatManagementServiceRecord = <S extends ChatManagementSchemas>({
  channelService,
  connectionService,
  status,
}: {
  readonly channelService: ChatChannelServiceContract<S>;
  readonly connectionService: ChatConnectionServiceContract<S>;
  readonly status: S["IntegrationStatus"];
}): ChatManagementServiceContract<S> => ({
  connectComplete: connectionService.connectComplete,
  connectStart: connectionService.connectStart,
  disconnect: connectionService.disconnect,
  listChannels: channelService.listChannels,
  listConnections: connectionService.listConnections,
  setChannelNotifications: channelService.setChannelNotifications,
  status: Effect.succeed(status),
});
