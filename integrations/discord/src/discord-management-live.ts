import type { Database } from "@feeblo/db";
import {
  type DiscordApiClient,
  makeDiscordApiClient,
} from "@feeblo/integration-discord";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import {
  DiscordChannelService,
  makeDiscordChannelServiceLive,
} from "./discord-channel-service";
import {
  DiscordConnectionService,
  makeDiscordConnectionServiceLive,
} from "./discord-connection-service";
import { DiscordManagementService } from "@feeblo/domain/integration/discord/management-service";

/**
 * Composes the connection lifecycle and channel services behind the single
 * organization-scoped management boundary. The composition shares one API
 * client and owns no operation logic of its own.
 */
export const makeDiscordManagementServiceLive = (
  apiClient: DiscordApiClient = makeDiscordApiClient()
): Layer.Layer<
  DiscordManagementService,
  never,
  Database.Database | DiscordIntegrationConfig
> =>
  Layer.effect(
    DiscordManagementService,
    Effect.gen(function* () {
      const config = yield* DiscordIntegrationConfig;
      const connectionService = yield* DiscordConnectionService;
      const channelService = yield* DiscordChannelService;
      return DiscordManagementService.of({
        connectComplete: connectionService.connectComplete,
        connectStart: connectionService.connectStart,
        disconnect: connectionService.disconnect,
        listChannels: channelService.listChannels,
        listConnections: connectionService.listConnections,
        setChannelNotifications: channelService.setChannelNotifications,
        status: () => Effect.succeed({ configured: config.configured }),
      });
    })
  ).pipe(
    Layer.provide(makeDiscordConnectionServiceLive(apiClient)),
    Layer.provide(makeDiscordChannelServiceLive(apiClient))
  );

/** Live layer with the default fetch-backed Discord API client. */
export const DiscordManagementServiceLive = makeDiscordManagementServiceLive();
