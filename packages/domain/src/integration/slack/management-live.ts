import type { Database } from "@feeblo/db";
import {
  makeSlackApiClient,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SlackIntegrationConfig } from "./config";
import { SlackManagementService } from "./management-service";
import {
  makeSlackChannelServiceLive,
  SlackChannelService,
} from "./slack-channel-service";
import {
  makeSlackConnectionServiceLive,
  SlackConnectionService,
} from "./slack-connection-service";

/**
 * Composes the connection lifecycle and channel services behind the single
 * organization-scoped management boundary. The composition shares one API
 * client and owns no operation logic of its own.
 */
export const makeSlackManagementServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackManagementService,
  never,
  Database.Database | SlackIntegrationConfig
> =>
  Layer.effect(
    SlackManagementService,
    Effect.gen(function* () {
      const config = yield* SlackIntegrationConfig;
      const connectionService = yield* SlackConnectionService;
      const channelService = yield* SlackChannelService;
      return SlackManagementService.of({
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
    Layer.provide(makeSlackConnectionServiceLive(apiClient)),
    Layer.provide(makeSlackChannelServiceLive(apiClient))
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackManagementServiceLive = makeSlackManagementServiceLive();
