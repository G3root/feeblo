import { currentDb, type Database, schema } from "@feeblo/db";
import { IntegrationRouteId } from "@feeblo/id";
import {
  DISCORD_NOTIFICATION_CHANNEL_TYPES,
  type DiscordApiClient,
  makeDiscordApiClient,
} from "@feeblo/integration-discord";
import { DiscordChannelNotificationRouteConfiguration } from "@feeblo/integration-discord/manifest";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InternalServerError, NotFoundError } from "../../rpc-errors";
import { DiscordIntegrationConfig } from "./config";
import {
  findDiscordConnection,
  lockDiscordConnection,
  mapDiscordApiError,
  mapManagementError,
} from "./discord-management-shared";
import type { DiscordIntegrationError } from "./errors";
import type * as S from "./schema";

const decodeProviderConfig = (value: unknown) =>
  Schema.decodeUnknownEffect(DiscordChannelNotificationRouteConfiguration)(
    value ?? {}
  ).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Discord route configuration is invalid",
        })
    )
  );

/**
 * Channel listing and channel-notification routing for an active Discord
 * connection: lists the guild's text channels and toggles per-channel
 * notification routes.
 */
export interface DiscordChannelServiceShape {
  readonly listChannels: (
    input: S.TDiscordChannelList
  ) => Effect.Effect<readonly S.TDiscordChannel[], DiscordIntegrationError>;
  readonly setChannelNotifications: (
    input: S.TDiscordChannelNotificationsUpdate
  ) => Effect.Effect<void, DiscordIntegrationError>;
}

export class DiscordChannelService extends Context.Service<
  DiscordChannelService,
  DiscordChannelServiceShape
>()("@feeblo/DiscordChannelService") {}

/** Creates the Discord channel service with an injectable API client. */
export const makeDiscordChannelServiceLive = (
  apiClient: DiscordApiClient = makeDiscordApiClient()
): Layer.Layer<
  DiscordChannelService,
  never,
  Database.Database | DiscordIntegrationConfig
> =>
  Layer.effect(
    DiscordChannelService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* DiscordIntegrationConfig;

      const listChannels = Effect.fn("DiscordChannel.listChannels")(
        function* (input: S.TDiscordChannelList) {
          const [connection] = yield* findDiscordConnection(
            db,
            input.connectionId,
            input.organizationId
          );
          if (connection === undefined || connection.lifecycle !== "active") {
            return yield* new NotFoundError({
              message: "Discord connection was not found",
            });
          }
          if (connection.remoteAccountId === null) {
            return yield* new NotFoundError({
              message: "Discord connection was not found",
            });
          }
          const routeRows = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              and(
                eq(
                  schema.integrationRouteTable.connectionId,
                  input.connectionId
                ),
                eq(
                  schema.integrationRouteTable.capabilityKey,
                  "channel.notifications"
                ),
                eq(schema.integrationRouteTable.enabled, true)
              )
            );
          const notificationChannels = yield* Effect.forEach(
            routeRows,
            (route) =>
              decodeProviderConfig(route.providerConfig).pipe(
                Effect.map((routeConfig) => routeConfig.channelId)
              )
          );
          const enabledChannels = new Set(notificationChannels);
          // `guilds/{guildId}/channels` returns every channel in one request;
          // only text and announcement channels can carry notifications.
          const discordChannels = yield* apiClient
            .guildsChannels({
              botToken: config.botToken,
              guildId: connection.remoteAccountId,
            })
            .pipe(mapDiscordApiError("channel listing"));
          return discordChannels
            .filter((channel) =>
              DISCORD_NOTIFICATION_CHANNEL_TYPES.includes(
                channel.type as (typeof DISCORD_NOTIFICATION_CHANNEL_TYPES)[number]
              )
            )
            .map((channel) => ({
              id: channel.id,
              name: channel.name,
              notificationsEnabled: enabledChannels.has(channel.id),
            }));
        },
        (effect) => effect.pipe(mapManagementError("channel list"))
      );

      const setChannelNotifications = Effect.fn(
        "DiscordChannel.setChannelNotifications"
      )(function* (input: S.TDiscordChannelNotificationsUpdate) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockDiscordConnection(
                db,
                input.connectionId,
                input.organizationId
              );
              if (
                connection === undefined ||
                connection.lifecycle !== "active"
              ) {
                return yield* new NotFoundError({
                  message: "Discord connection was not found",
                });
              }
              // One route per channel: look the target channel's route up by
              // its routeKey (the channel id) instead of decoding every
              // channel.notifications route's providerConfig.
              const [route] = yield* db
                .select()
                .from(schema.integrationRouteTable)
                .where(
                  and(
                    eq(
                      schema.integrationRouteTable.connectionId,
                      input.connectionId
                    ),
                    eq(
                      schema.integrationRouteTable.capabilityKey,
                      "channel.notifications"
                    ),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    ),
                    eq(schema.integrationRouteTable.routeKey, input.channelId)
                  )
                )
                .limit(1);
              // The channel display name always comes from the caller; the
              // stale name stored on a previous selection must never leak
              // into the new configuration.
              const channelName = input.channelName;
              const now = new Date();
              if (input.enabled) {
                if (route === undefined) {
                  yield* db.insert(schema.integrationRouteTable).values({
                    capabilityKey: "channel.notifications",
                    configVersion: 1,
                    connectionId: input.connectionId,
                    enabled: true,
                    eventTypes: ["feedback.post.created"],
                    id: yield* IntegrationRouteId.generate,
                    organizationId: input.organizationId,
                    providerConfig: {
                      channelId: input.channelId,
                      version: 1,
                    },
                    routeKey: input.channelId,
                    safeDisplayMetadata: { channelName },
                    createdAt: now,
                    updatedAt: now,
                  });
                } else if (route.enabled !== true) {
                  yield* db
                    .update(schema.integrationRouteTable)
                    .set({
                      enabled: true,
                      eventTypes: ["feedback.post.created"],
                      providerConfig: {
                        channelId: input.channelId,
                        version: 1,
                      },
                      safeDisplayMetadata: { channelName },
                      updatedAt: now,
                    })
                    .where(eq(schema.integrationRouteTable.id, route.id));
                }
              } else if (route?.enabled === true) {
                yield* db
                  .update(schema.integrationRouteTable)
                  .set({ enabled: false, updatedAt: now })
                  .where(eq(schema.integrationRouteTable.id, route.id));
                yield* db
                  .update(schema.integrationDeliveryTable)
                  .set({ canceledAt: now, state: "canceled", updatedAt: now })
                  .where(
                    and(
                      eq(schema.integrationDeliveryTable.routeId, route.id),
                      eq(schema.integrationDeliveryTable.state, "pending")
                    )
                  );
              }
            })
          )
          .pipe(mapManagementError("channel notifications update"));
      });

      return DiscordChannelService.of({
        listChannels,
        setChannelNotifications,
      });
    })
  );

/** Live layer with the default fetch-backed Discord API client. */
export const DiscordChannelServiceLive = makeDiscordChannelServiceLive();
