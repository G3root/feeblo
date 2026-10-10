import type { Database } from "@feeblo/db";
import { chatManagementServiceRecord } from "@feeblo/domain/integration/chat/management-service";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import {
  SlackManagementService,
  type SlackManagementSchemas,
} from "@feeblo/domain/integration/slack/management-service";
import {
  makeSlackApiClient,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
 * client and owns no operation logic of its own; the method forwarding comes
 * from the shared chat record.
 */
export const makeSlackManagementServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackManagementService,
  never,
  Database.Database | SlackIntegrationConfig | Crypto.Crypto
> =>
  Layer.effect(
    SlackManagementService,
    Effect.gen(function* () {
      const config = yield* SlackIntegrationConfig;
      const connectionService = yield* SlackConnectionService;
      const channelService = yield* SlackChannelService;
      return SlackManagementService.of(
        chatManagementServiceRecord<SlackManagementSchemas>({
          channelService,
          connectionService,
          status: { configured: config.configured },
        })
      );
    })
  ).pipe(
    Layer.provide(makeSlackConnectionServiceLive(apiClient)),
    Layer.provide(makeSlackChannelServiceLive(apiClient))
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackManagementServiceLive = makeSlackManagementServiceLive();
