import { currentDb, type Database, schema } from "@feeblo/db";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationRouteId,
} from "@feeblo/id";
import {
  makeSlackApiClient,
  SLACK_OAUTH_AUTHORIZE_URL,
  type SlackApiClient,
  type SlackApiFailure,
  SlackOAuthState,
} from "@feeblo/integration-slack";
import {
  decryptSlackCredentialMaterial,
  encryptSlackCredentialMaterial,
} from "@feeblo/integration-slack/credentials";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "../../rpc-errors";
import { SlackIntegrationConfig } from "./config";
import { SlackIntegrationErrors } from "./errors";
import { SlackManagementService } from "./management-service";
import type * as S from "./schema";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const CHANNELS_PAGE_SIZE = 200;

const SlackSafeDisplayMetadata = Schema.Struct({
  teamId: Schema.optionalKey(Schema.String),
  teamName: Schema.optionalKey(Schema.String),
  botUserId: Schema.optionalKey(Schema.String),
});

const SlackChannelNotificationProviderConfig = Schema.Struct({
  version: Schema.Literal(1),
  channelId: Schema.String,
  channelName: Schema.String,
});

const decodeSafeDisplayMetadata = (value: unknown) =>
  Schema.decodeUnknownEffect(SlackSafeDisplayMetadata)(value ?? {}).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Slack display metadata is invalid",
        })
    )
  );

const decodeProviderConfig = (value: unknown) =>
  Schema.decodeUnknownEffect(SlackChannelNotificationProviderConfig)(
    value ?? {}
  ).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Slack route configuration is invalid",
        })
    )
  );

const mapManagementError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error: unknown) =>
        Schema.is(SlackIntegrationErrors)(error)
          ? error
          : new InternalServerError({
              message: `Slack ${operation} failed`,
            })
      )
    );

const mapSlackApiError = (operation: string) =>
  Effect.mapError((error: SlackApiFailure) => {
    switch (error._tag) {
      case "IntegrationProviderAuthenticationError":
        return new InternalServerError({
          message: `Slack rejected authentication during ${operation}`,
        });
      case "IntegrationProviderRateLimitedError":
        return new InternalServerError({
          message: `Slack rate limited ${operation}`,
        });
      case "IntegrationProviderTemporaryFailure":
        return new InternalServerError({
          message: `Slack temporarily failed during ${operation}`,
        });
      case "IntegrationProviderInvalidConfigurationError":
        return new InternalServerError({
          message: `Slack configuration is invalid during ${operation}`,
        });
      case "IntegrationProviderPermanentRejection":
        return new InternalServerError({
          message: `Slack rejected ${operation}`,
        });
      case "IntegrationProviderChannelAlreadyJoinedError":
        return new InternalServerError({
          message: `Slack ${operation} was already applied`,
        });
      default:
        // Defensive arm for a future provider failure tag; the union is closed.
        return new InternalServerError({
          message: `Slack ${operation} failed`,
        });
    }
  });

/** Live Slack management service backed by the PostgreSQL schema and Slack API. */
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
      const db = yield* currentDb;
      const config = yield* SlackIntegrationConfig;

      const findSlackConnection = (
        connectionId: string,
        organizationId: string
      ) =>
        db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(schema.integrationConnectionTable.id, connectionId),
              eq(
                schema.integrationConnectionTable.organizationId,
                organizationId
              ),
              eq(schema.integrationConnectionTable.provider, slackProviderKey)
            )
          )
          .limit(1);

      // Row lock for connection updates inside transactions; plain reads use
      // findSlackConnection instead.
      const lockSlackConnection = (
        connectionId: string,
        organizationId: string
      ) => findSlackConnection(connectionId, organizationId).for("update");

      const connectStart = Effect.fn("SlackManagement.connectStart")(
        function* ({ organizationId }: { readonly organizationId: string }) {
          const nonce = crypto.randomUUID();
          const connectionId = yield* IntegrationConnectionId.generate;
          const ciphertext = yield* encryptSlackCredentialMaterial(
            config.encryptionKey,
            { oauthState: nonce }
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Slack credentials could not be encrypted",
                })
            )
          );
          yield* db.insert(schema.integrationConnectionTable).values({
            credentialGeneration: 1,
            credentialsCiphertext: ciphertext,
            id: connectionId,
            lifecycle: "connecting",
            name: "Slack",
            organizationId,
            provider: slackProviderKey,
            safeDisplayMetadata: {},
          });
          const state = yield* Schema.encodeEffect(
            Schema.fromJsonString(SlackOAuthState)
          )({
            connectionId,
            nonce,
            organizationId,
          }).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Slack OAuth state could not be encoded",
                })
            )
          );
          const authorizeUrl = new URL(SLACK_OAUTH_AUTHORIZE_URL);
          authorizeUrl.searchParams.set("client_id", config.clientId);
          authorizeUrl.searchParams.set(
            "scope",
            config.authorizeScopes.join(",")
          );
          authorizeUrl.searchParams.set(
            "redirect_uri",
            config.oauthRedirectUrl
          );
          authorizeUrl.searchParams.set("state", state);
          return { authorizeUrl };
        },
        (effect) => effect.pipe(mapManagementError("connect start"))
      );

      const connectComplete = Effect.fn("SlackManagement.connectComplete")(
        function* ({
          code,
          state,
        }: {
          readonly code: string;
          readonly state: string;
        }) {
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(SlackOAuthState)
          )(state).pipe(
            Effect.mapError(
              () =>
                new BadRequestError({
                  message: "Slack OAuth state is invalid",
                })
            )
          );
          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              and(
                eq(schema.integrationConnectionTable.id, decoded.connectionId),
                eq(
                  schema.integrationConnectionTable.organizationId,
                  decoded.organizationId
                ),
                eq(
                  schema.integrationConnectionTable.provider,
                  slackProviderKey
                ),
                eq(schema.integrationConnectionTable.lifecycle, "connecting")
              )
            )
            .limit(1);
          if (connection === undefined) {
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
          if (credentials.oauthState !== decoded.nonce) {
            return yield* new BadRequestError({
              message: "Slack OAuth state does not match",
            });
          }
          const oauth = yield* apiClient
            .oauthV2Access({
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              code,
              redirectUri: config.oauthRedirectUrl,
            })
            .pipe(mapSlackApiError("OAuth handshake"));
          const botToken = Redacted.make(oauth.access_token);
          const authTest = yield* apiClient
            .authTest({ botToken })
            .pipe(mapSlackApiError("workspace verification"));
          const teamInfo = yield* apiClient
            .teamInfo({ botToken })
            .pipe(mapSlackApiError("workspace lookup"));
          const ciphertext = yield* encryptSlackCredentialMaterial(
            config.encryptionKey,
            {
              botToken: oauth.access_token,
              ...(oauth.authed_user?.access_token === undefined
                ? {}
                : { userToken: oauth.authed_user.access_token }),
              ...(oauth.incoming_webhook?.url === undefined
                ? {}
                : { incomingWebhookUrl: oauth.incoming_webhook.url }),
            }
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Slack credentials could not be encrypted",
                })
            )
          );
          const now = new Date();
          yield* db.transaction(() =>
            Effect.gen(function* () {
              yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  credentialGeneration: 1,
                  credentialsCiphertext: ciphertext,
                  lifecycle: "active",
                  name: teamInfo.team.name,
                  remoteAccountId: authTest.team_id,
                  safeDisplayMetadata: {
                    botUserId: authTest.user_id,
                    teamId: authTest.team_id,
                    teamName: teamInfo.team.name,
                  },
                  updatedAt: now,
                })
                .where(eq(schema.integrationConnectionTable.id, connection.id));
              // One inbound route per capability; Slack routes requests by team
              // id so a single workspace connection owns both surfaces.
              for (const capabilityKey of [
                "commands",
                "message.action",
              ] as const) {
                yield* db.insert(schema.integrationRouteTable).values({
                  capabilityKey,
                  configVersion: 1,
                  connectionId: connection.id,
                  enabled: true,
                  eventTypes: [],
                  id: yield* IntegrationRouteId.generate,
                  organizationId: decoded.organizationId,
                  providerConfig: { version: 1 },
                  safeDisplayMetadata: {},
                });
              }
            })
          );
          return { organizationId: decoded.organizationId };
        },
        (effect) => effect.pipe(mapManagementError("connect complete"))
      );

      const listConnections = Effect.fn("SlackManagement.listConnections")(
        function* ({ organizationId }: { readonly organizationId: string }) {
          const rows = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              and(
                eq(
                  schema.integrationConnectionTable.organizationId,
                  organizationId
                ),
                eq(
                  schema.integrationConnectionTable.provider,
                  slackProviderKey
                ),
                inArray(schema.integrationConnectionTable.lifecycle, [
                  "connecting",
                  "active",
                  "paused",
                  "reauth_required",
                  "disconnecting",
                  "disconnected",
                  "revocation_unconfirmed",
                ])
              )
            )
            .orderBy(desc(schema.integrationConnectionTable.createdAt));
          return yield* Effect.forEach(rows, (connection) =>
            decodeSafeDisplayMetadata(connection.safeDisplayMetadata).pipe(
              Effect.map((metadata) => ({
                createdAt: connection.createdAt,
                id: asLegid(IntegrationConnectionId)(connection.id),
                lifecycle: connection.lifecycle,
                teamId: metadata.teamId ?? null,
                teamName: metadata.teamName ?? connection.name,
              }))
            )
          );
        },
        (effect) => effect.pipe(mapManagementError("list"))
      );

      const listChannels = Effect.fn("SlackManagement.listChannels")(
        function* (input: S.TSlackChannelList) {
          const [connection] = yield* findSlackConnection(
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
          const channels = yield* apiClient
            .conversationsList({
              botToken: credentials.botToken,
              limit: CHANNELS_PAGE_SIZE,
              types: "public_channel,private_channel",
            })
            .pipe(mapSlackApiError("channel listing"));
          return channels.channels
            .filter((channel) => channel.is_archived !== true)
            .map((channel) => ({
              id: channel.id,
              isMember: channel.is_member === true,
              // Slack channel ids: C = public channel, G = private channel.
              isPrivate: channel.id.startsWith("G"),
              name: channel.name,
              notificationsEnabled: enabledChannels.has(channel.id),
            }));
        },
        (effect) => effect.pipe(mapManagementError("channel list"))
      );

      const setChannelNotifications = Effect.fn(
        "SlackManagement.setChannelNotifications"
      )(function* (input: S.TSlackChannelNotificationsUpdate) {
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockSlackConnection(
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
              // One route per channel: find the enabled route whose
              // providerConfig channelId matches the target channel rather
              // than assuming a single notifications route per connection.
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
                    eq(
                      schema.integrationRouteTable.organizationId,
                      input.organizationId
                    )
                  )
                );
              const routesByChannel = yield* Effect.forEach(
                routeRows,
                (route) =>
                  decodeProviderConfig(route.providerConfig).pipe(
                    Effect.map((config) => ({
                      channelId: config.channelId,
                      route,
                    }))
                  )
              );
              const route = routesByChannel.find(
                (entry) => entry.channelId === input.channelId
              )?.route;
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
                      channelName,
                      version: 1,
                    },
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
                        channelName,
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

      const disconnect = Effect.fn("SlackManagement.disconnect")(function* (
        input: S.TSlackConnectionDisconnect
      ) {
        const { connectionId, organizationId } = input;
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockSlackConnection(
                connectionId,
                organizationId
              );
              if (connection === undefined) {
                return yield* new NotFoundError({
                  message: "Slack connection was not found",
                });
              }
              if (connection.lifecycle === "archived") {
                return;
              }
              const now = new Date();
              yield* db
                .update(schema.integrationConnectionTable)
                .set({ lifecycle: "disconnecting", updatedAt: now })
                .where(eq(schema.integrationConnectionTable.id, connectionId));
              yield* db
                .update(schema.integrationRouteTable)
                .set({ enabled: false, updatedAt: now })
                .where(
                  and(
                    eq(schema.integrationRouteTable.connectionId, connectionId),
                    eq(
                      schema.integrationRouteTable.organizationId,
                      organizationId
                    )
                  )
                );
              yield* db
                .update(schema.integrationDeliveryTable)
                .set({ canceledAt: now, state: "canceled", updatedAt: now })
                .where(
                  and(
                    eq(
                      schema.integrationDeliveryTable.connectionId,
                      connectionId
                    ),
                    eq(
                      schema.integrationDeliveryTable.organizationId,
                      organizationId
                    ),
                    eq(schema.integrationDeliveryTable.state, "pending")
                  )
                );
            })
          )
          .pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                // Best-effort remote revocation: never fails the local
                // disconnect when Slack is unreachable.
                const [connection] = yield* db
                  .select({
                    credentialsCiphertext:
                      schema.integrationConnectionTable.credentialsCiphertext,
                  })
                  .from(schema.integrationConnectionTable)
                  .where(
                    eq(schema.integrationConnectionTable.id, connectionId)
                  );
                if (
                  connection?.credentialsCiphertext !== null &&
                  connection?.credentialsCiphertext !== undefined
                ) {
                  const credentials = yield* Effect.exit(
                    decryptSlackCredentialMaterial(
                      config.encryptionKey,
                      connection.credentialsCiphertext
                    )
                  );
                  if (
                    Exit.isSuccess(credentials) &&
                    credentials.value.botToken !== undefined
                  ) {
                    yield* Effect.exit(
                      apiClient.authRevoke({
                        botToken: credentials.value.botToken,
                      })
                    );
                  }
                }
                const now = new Date();
                yield* db
                  .update(schema.integrationConnectionTable)
                  .set({
                    archivedAt: now,
                    credentialsCiphertext: null,
                    lifecycle: "archived",
                    retentionExpiresAt: new Date(now.getTime() + retentionMs),
                    updatedAt: now,
                  })
                  .where(
                    eq(schema.integrationConnectionTable.id, connectionId)
                  );
              })
            ),
            mapManagementError("disconnect")
          );
      });

      return {
        connectComplete,
        connectStart,
        disconnect,
        listChannels,
        listConnections,
        setChannelNotifications,
      };
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackManagementServiceLive = makeSlackManagementServiceLive();
