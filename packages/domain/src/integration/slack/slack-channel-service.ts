import { currentDb, type Database, schema } from "@feeblo/db";
import { IntegrationRouteId } from "@feeblo/id";
import {
  makeSlackApiClient,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import { decryptSlackCredentialMaterial } from "@feeblo/integration-slack/credentials";
import { SlackChannelNotificationRouteConfiguration } from "@feeblo/integration-slack/manifest";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InternalServerError, NotFoundError } from "../../rpc-errors";
import { SlackIntegrationConfig } from "./config";
import type { SlackIntegrationError } from "./errors";
import type * as S from "./schema";
import {
  findSlackConnection,
  lockSlackConnection,
  mapManagementError,
  mapSlackApiError,
} from "./slack-management-shared";

const CHANNELS_PAGE_SIZE = 200;
const MAX_CHANNEL_PAGES = 25;

const decodeProviderConfig = (value: unknown) =>
  Schema.decodeUnknownEffect(SlackChannelNotificationRouteConfiguration)(
    value ?? {}
  ).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Slack route configuration is invalid",
        })
    )
  );

/**
 * Channel listing and channel-notification routing for an active Slack
 * connection: lists the bot's channels and toggles per-channel notification
 * routes.
 */
export interface SlackChannelServiceShape {
  readonly listChannels: (
    input: S.TSlackChannelList
  ) => Effect.Effect<readonly S.TSlackChannel[], SlackIntegrationError>;
  readonly setChannelNotifications: (
    input: S.TSlackChannelNotificationsUpdate
  ) => Effect.Effect<void, SlackIntegrationError>;
}

export class SlackChannelService extends Context.Service<
  SlackChannelService,
  SlackChannelServiceShape
>()("@feeblo/SlackChannelService") {}

/** Creates the Slack channel service with an injectable API client. */
export const makeSlackChannelServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackChannelService,
  never,
  Database.Database | SlackIntegrationConfig
> =>
  Layer.effect(
    SlackChannelService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* SlackIntegrationConfig;

      const listChannels = Effect.fn("SlackChannel.listChannels")(
        function* (input: S.TSlackChannelList) {
          const [connection] = yield* findSlackConnection(
            db,
            input.connectionId,
            input.organizationId
          );
          if (connection === undefined || connection.lifecycle !== "active") {
            return yield* new NotFoundError({
              message: "Slack connection was not found",
            });
          }
          if (connection.credentialsCiphertext === null) {
            return yield* new NotFoundError({
              message: "Slack connection was not found",
            });
          }
          const credentials = yield* decryptSlackCredentialMaterial(
            config.encryptionKey,
            connection.credentialsCiphertext
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Slack credentials could not be decrypted",
                })
            )
          );
          if (credentials.botToken === undefined) {
            return yield* new NotFoundError({
              message: "Slack connection was not found",
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
                Effect.map((config) => config.channelId)
              )
          );
          const enabledChannels = new Set(notificationChannels);
          // Follow `response_metadata.next_cursor` until Slack returns an empty
          // cursor, accumulating channels from every page. A hard page cap
          // bounds the loop against a misbehaving cursor.
          let cursor: string | undefined;
          const channels: S.TSlackChannel[] = [];
          for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
            const pageResult = yield* apiClient
              .conversationsList({
                botToken: credentials.botToken,
                limit: CHANNELS_PAGE_SIZE,
                types: "public_channel,private_channel",
                ...(cursor === undefined ? {} : { cursor }),
              })
              .pipe(mapSlackApiError("channel listing"));
            for (const channel of pageResult.channels) {
              if (channel.is_archived !== true) {
                channels.push({
                  id: channel.id,
                  isMember: channel.is_member === true,
                  isPrivate: channel.is_private === true,
                  name: channel.name,
                  notificationsEnabled: enabledChannels.has(channel.id),
                });
              }
            }
            const nextCursor = pageResult.response_metadata?.next_cursor;
            if (nextCursor === undefined || nextCursor === "") {
              break;
            }
            cursor = nextCursor;
          }
          return channels;
        },
        (effect) => effect.pipe(mapManagementError("channel list"))
      );

      const setChannelNotifications = Effect.fn(
        "SlackChannel.setChannelNotifications"
      )(function* (input: S.TSlackChannelNotificationsUpdate) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockSlackConnection(
                db,
                input.connectionId,
                input.organizationId
              );
              if (
                connection === undefined ||
                connection.lifecycle !== "active"
              ) {
                return yield* new NotFoundError({
                  message: "Slack connection was not found",
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

      return SlackChannelService.of({
        listChannels,
        setChannelNotifications,
      });
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackChannelServiceLive = makeSlackChannelServiceLive();
