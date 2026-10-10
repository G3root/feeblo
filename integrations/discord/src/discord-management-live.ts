import type { Database } from "@feeblo/db";
import { chatManagementServiceRecord } from "@feeblo/domain/integration/chat/management-service";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import {
  DiscordManagementService,
  type DiscordManagementSchemas,
} from "@feeblo/domain/integration/discord/management-service";
import {
  makeDiscordApiClient,
  type DiscordApiClient,
} from "@feeblo/integration-discord";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  DiscordChannelService,
  makeDiscordChannelServiceLive,
} from "./discord-channel-service";
import {
  DiscordConnectionService,
  makeDiscordConnectionServiceLive,
} from "./discord-connection-service";

/**
 * Composes the connection lifecycle and channel services behind the single
 * organization-scoped management boundary. The composition shares one API
 * client and owns no operation logic of its own; the method forwarding comes
 * from the shared chat record.
 */
export const makeDiscordManagementServiceLive = (
  apiClient: DiscordApiClient = makeDiscordApiClient()
): Layer.Layer<
  DiscordManagementService,
  never,
  Database.Database | DiscordIntegrationConfig | Crypto.Crypto
> =>
  Layer.effect(
    DiscordManagementService,
    Effect.gen(function* () {
      const config = yield* DiscordIntegrationConfig;
      const connectionService = yield* DiscordConnectionService;
      const channelService = yield* DiscordChannelService;
      return DiscordManagementService.of(
        chatManagementServiceRecord<DiscordManagementSchemas>({
          channelService,
          connectionService,
          status: { configured: config.configured },
        })
      );
    })
  ).pipe(
    Layer.provide(makeDiscordConnectionServiceLive(apiClient)),
    Layer.provide(makeDiscordChannelServiceLive(apiClient))
  );

/** Live layer with the default fetch-backed Discord API client. */
export const DiscordManagementServiceLive = makeDiscordManagementServiceLive();
