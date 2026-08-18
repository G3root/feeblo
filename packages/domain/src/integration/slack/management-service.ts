import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { SlackIntegrationError } from "./errors";
import type * as S from "./schema";

/** Organization-scoped Slack management boundary; read methods never return credentials. */
export interface SlackManagementServiceShape {
  /** Completes the OAuth handshake; called by the server callback route. */
  readonly connectComplete: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<
    { readonly organizationId: string },
    SlackIntegrationError
  >;
  readonly connectStart: (
    input: S.TSlackConnectStart
  ) => Effect.Effect<S.TSlackConnectStarted, SlackIntegrationError>;
  readonly disconnect: (
    input: S.TSlackConnectionDisconnect
  ) => Effect.Effect<void, SlackIntegrationError>;
  readonly listChannels: (
    input: S.TSlackChannelList
  ) => Effect.Effect<readonly S.TSlackChannel[], SlackIntegrationError>;
  readonly listConnections: (
    input: S.TSlackConnectionList
  ) => Effect.Effect<readonly S.TSlackConnection[], SlackIntegrationError>;
  readonly setChannelNotifications: (
    input: S.TSlackChannelNotificationsUpdate
  ) => Effect.Effect<void, SlackIntegrationError>;
  /** Reports whether the Slack integration is configured for this deployment. */
  readonly status: () => Effect.Effect<S.TSlackIntegrationStatus, never>;
}

/** Service key implemented by the server composition root for Slack commands. */
export class SlackManagementService extends Context.Service<
  SlackManagementService,
  SlackManagementServiceShape
>()("@feeblo/SlackManagementService") {}
