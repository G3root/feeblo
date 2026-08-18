import type { LegidFrom, WorkspaceId } from "@feeblo/id";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { DiscordIntegrationError } from "./errors";
import type * as S from "./schema";

/** Organization-scoped Discord management boundary; read methods never return credentials. */
export interface DiscordManagementServiceShape {
  /** Completes the OAuth handshake; called by the server callback route. */
  readonly connectComplete: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<
    { readonly organizationId: LegidFrom<typeof WorkspaceId> },
    DiscordIntegrationError
  >;
  readonly connectStart: (
    input: S.TDiscordConnectStart
  ) => Effect.Effect<S.TDiscordConnectStarted, DiscordIntegrationError>;
  readonly disconnect: (
    input: S.TDiscordConnectionDisconnect
  ) => Effect.Effect<void, DiscordIntegrationError>;
  readonly listChannels: (
    input: S.TDiscordChannelList
  ) => Effect.Effect<readonly S.TDiscordChannel[], DiscordIntegrationError>;
  readonly listConnections: (
    input: S.TDiscordConnectionList
  ) => Effect.Effect<readonly S.TDiscordConnection[], DiscordIntegrationError>;
  readonly setChannelNotifications: (
    input: S.TDiscordChannelNotificationsUpdate
  ) => Effect.Effect<void, DiscordIntegrationError>;
  /** Reports whether the Discord integration is configured for this deployment. */
  readonly status: () => Effect.Effect<S.TDiscordIntegrationStatus, never>;
}

/** Service key implemented by the server composition root for Discord commands. */
export class DiscordManagementService extends Context.Service<
  DiscordManagementService,
  DiscordManagementServiceShape
>()("@feeblo/DiscordManagementService") {}
