import { currentDb, type Database, schema } from "@feeblo/db";
import { DiscordIntegrationConfig } from "@feeblo/domain/integration/discord/config";
import type { DiscordIntegrationError } from "@feeblo/domain/integration/discord/errors";
import type * as S from "@feeblo/domain/integration/discord/schema";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "@feeblo/domain/rpc-errors";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationRouteId,
  type LegidFrom,
  WorkspaceId,
} from "@feeblo/id";
import {
  DISCORD_GUILD_COMMANDS,
  DISCORD_OAUTH_AUTHORIZE_URL,
  type DiscordApiClient,
  DiscordOAuthState,
  makeDiscordApiClient,
} from "@feeblo/integration-discord";
import { encryptDiscordCredentialMaterial } from "@feeblo/integration-discord/credentials";
import {
  discordInteractionsCapabilityKey,
  discordProviderKey,
} from "@feeblo/integration-discord/manifest";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  decryptConnectionCredentials,
  findDiscordConnection,
  lockDiscordConnection,
  mapDiscordApiError,
  mapManagementError,
} from "./discord-management-shared";

const retentionMs = 30 * 24 * 60 * 60 * 1000;

const DiscordSafeDisplayMetadata = Schema.Struct({
  guildId: Schema.optionalKey(Schema.String),
  guildName: Schema.optionalKey(Schema.String),
  installerUserId: Schema.optionalKey(Schema.String),
});

const decodeSafeDisplayMetadata = (value: Schema.Json) =>
  Schema.decodeUnknownEffect(DiscordSafeDisplayMetadata)(value ?? {}).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Discord display metadata is invalid",
        })
    )
  );

/**
 * OAuth connection lifecycle: installing a Discord guild (connect start and
 * completion with guild-scoped command registration), listing connections,
 * and disconnecting with credential erasure.
 */
export interface DiscordConnectionServiceContract {
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
  readonly listConnections: (
    input: S.TDiscordConnectionList
  ) => Effect.Effect<readonly S.TDiscordConnection[], DiscordIntegrationError>;
}

export class DiscordConnectionService extends Context.Service<
  DiscordConnectionService,
  DiscordConnectionServiceContract
>()("@feeblo/DiscordConnectionService") {}

/** Creates the Discord connection lifecycle service with an injectable API client. */
export const makeDiscordConnectionServiceLive = (
  apiClient: DiscordApiClient = makeDiscordApiClient()
): Layer.Layer<
  DiscordConnectionService,
  never,
  Database.Database | DiscordIntegrationConfig
> =>
  Layer.effect(
    DiscordConnectionService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* DiscordIntegrationConfig;

      const connectStart = Effect.fn("DiscordConnection.connectStart")(
        function* ({ organizationId }: S.TDiscordConnectStart) {
          if (!config.configured) {
            return yield* new InternalServerError({
              message: "Discord integration is not configured",
            });
          }
          const nonce = crypto.randomUUID();
          const connectionId = yield* IntegrationConnectionId.generate;
          const ciphertext = yield* encryptDiscordCredentialMaterial(
            config.encryptionKey,
            { oauthState: nonce }
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Discord credentials could not be encrypted",
                })
            )
          );
          yield* db.transaction(() =>
            Effect.gen(function* () {
              // A new install attempt replaces any abandoned connecting row so
              // listConnections never accumulates stale in-progress entries.
              yield* db
                .delete(schema.integrationConnectionTable)
                .where(
                  and(
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      organizationId
                    ),
                    eq(
                      schema.integrationConnectionTable.provider,
                      discordProviderKey
                    ),
                    eq(
                      schema.integrationConnectionTable.lifecycle,
                      "connecting"
                    )
                  )
                );
              yield* db.insert(schema.integrationConnectionTable).values({
                credentialGeneration: 1,
                credentialsCiphertext: ciphertext,
                id: connectionId,
                lifecycle: "connecting",
                name: "Discord",
                organizationId,
                provider: discordProviderKey,
                safeDisplayMetadata: {},
              });
            })
          );
          const state = yield* Schema.encodeEffect(
            Schema.fromJsonString(DiscordOAuthState)
          )({
            connectionId,
            nonce,
            organizationId,
          }).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Discord OAuth state could not be encoded",
                })
            )
          );
          const authorizeUrl = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
          authorizeUrl.searchParams.set("client_id", config.clientId);
          authorizeUrl.searchParams.set("response_type", "code");
          authorizeUrl.searchParams.set(
            "redirect_uri",
            config.oauthRedirectUrl
          );
          authorizeUrl.searchParams.set(
            "scope",
            config.authorizeScopes.join(" ")
          );
          authorizeUrl.searchParams.set(
            "permissions",
            String(config.permissions)
          );
          authorizeUrl.searchParams.set("state", state);
          return { authorizeUrl };
        },
        (effect) => effect.pipe(mapManagementError("connect start"))
      );

      const connectComplete = Effect.fn("DiscordConnection.connectComplete")(
        function* ({
          code,
          state,
        }: {
          readonly code: string;
          readonly state: string;
        }) {
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(DiscordOAuthState)
          )(state).pipe(
            Effect.mapError(
              () =>
                new BadRequestError({
                  message: "Discord OAuth state is invalid",
                })
            )
          );
          const decodedOrganizationId = yield* Schema.decodeUnknownEffect(
            WorkspaceId.schema
          )(decoded.organizationId).pipe(
            Effect.mapError(
              () =>
                new BadRequestError({
                  message: "Discord OAuth state is invalid",
                })
            )
          );
          const organizationId = asLegid(WorkspaceId)(decodedOrganizationId);
          const [pendingConnection] = yield* findDiscordConnection(
            db,
            decoded.connectionId,
            organizationId
          );
          if (
            pendingConnection === undefined ||
            pendingConnection.lifecycle !== "connecting" ||
            pendingConnection.credentialsCiphertext === null
          ) {
            return yield* new NotFoundError({
              message: "Discord connection was not found",
            });
          }
          const pendingCredentials = yield* decryptConnectionCredentials(
            config,
            pendingConnection.credentialsCiphertext
          );
          if (pendingCredentials.oauthState !== decoded.nonce) {
            return yield* new BadRequestError({
              message: "Discord OAuth state does not match",
            });
          }
          // OAuth exchange runs before any transaction: the code is single-use,
          // so Discord itself serializes replays. The guarded connection
          // transition below is the idempotency boundary for concurrent
          // callback replays.
          const oauth = yield* apiClient
            .oauth2TokenExchange({
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              code,
              redirectUri: config.oauthRedirectUrl,
            })
            .pipe(mapDiscordApiError("OAuth handshake"));
          // The `guild` field is present only when the user actually added the
          // bot to a server; without it there is nothing to connect.
          if (oauth.guild === undefined) {
            return yield* new BadRequestError({
              message: "Discord install did not include a server",
            });
          }
          const guild = oauth.guild;
          const [connectionForAnotherOrganization] = yield* db
            .select({ id: schema.integrationConnectionTable.id })
            .from(schema.integrationConnectionTable)
            .where(
              and(
                eq(
                  schema.integrationConnectionTable.provider,
                  discordProviderKey
                ),
                eq(schema.integrationConnectionTable.remoteAccountId, guild.id),
                eq(schema.integrationConnectionTable.lifecycle, "active"),
                ne(
                  schema.integrationConnectionTable.organizationId,
                  organizationId
                )
              )
            )
            .limit(1);
          if (connectionForAnotherOrganization !== undefined) {
            return yield* new BadRequestError({
              message:
                "Discord server is already connected to another organization",
            });
          }
          // Register the guild-scoped commands up front; a failure here aborts
          // the install so the connection never activates without its surface.
          const application = yield* apiClient
            .applicationsMe({ botToken: config.botToken })
            .pipe(mapDiscordApiError("application lookup"));
          yield* apiClient
            .guildsCommandsBulkOverwrite({
              applicationId: application.id,
              botToken: config.botToken,
              commands: DISCORD_GUILD_COMMANDS,
              guildId: guild.id,
            })
            .pipe(mapDiscordApiError("command registration"));
          const ciphertext = yield* encryptDiscordCredentialMaterial(
            config.encryptionKey,
            { userToken: oauth.access_token }
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Discord credentials could not be encrypted",
                })
            )
          );
          return yield* db.transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockDiscordConnection(
                db,
                decoded.connectionId,
                organizationId
              );
              if (
                connection === undefined ||
                connection.lifecycle !== "connecting"
              ) {
                return yield* new NotFoundError({
                  message: "Discord connection was not found",
                });
              }
              if (connection.credentialsCiphertext === null) {
                return yield* new NotFoundError({
                  message: "Discord connection was not found",
                });
              }
              const credentials = yield* decryptConnectionCredentials(
                config,
                connection.credentialsCiphertext
              );
              if (credentials.oauthState !== decoded.nonce) {
                return yield* new BadRequestError({
                  message: "Discord OAuth state does not match",
                });
              }
              const now = new Date();
              // A Discord guild has at most one active connection per
              // organization: archive any pre-existing active connection for
              // the same guild before activating the current row, so
              // inbound-live resolves a single credential source.
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
                  and(
                    eq(
                      schema.integrationConnectionTable.organizationId,
                      organizationId
                    ),
                    eq(
                      schema.integrationConnectionTable.provider,
                      discordProviderKey
                    ),
                    eq(
                      schema.integrationConnectionTable.remoteAccountId,
                      guild.id
                    ),
                    eq(schema.integrationConnectionTable.lifecycle, "active")
                  )
                );
              yield* db
                .update(schema.integrationConnectionTable)
                .set({
                  credentialGeneration: 1,
                  credentialsCiphertext: ciphertext,
                  lifecycle: "active",
                  name: guild.name,
                  remoteAccountId: guild.id,
                  safeDisplayMetadata: {
                    guildId: guild.id,
                    guildName: guild.name,
                    ...(oauth.user !== undefined && {
                      installerUserId: oauth.user.id,
                    }),
                  },
                  updatedAt: now,
                })
                .where(eq(schema.integrationConnectionTable.id, connection.id));
              // One inbound route per connection: Discord routes all
              // interactions (slash commands, context menus, modal submits) to
              // the single `/discord/interactions` endpoint, keyed by guild id.
              // Duplicate replays are ignored via the connection/capability
              // unique index.
              yield* db
                .insert(schema.integrationRouteTable)
                .values({
                  capabilityKey: discordInteractionsCapabilityKey,
                  configVersion: 1,
                  connectionId: connection.id,
                  enabled: true,
                  eventTypes: [],
                  id: yield* IntegrationRouteId.generate,
                  organizationId,
                  providerConfig: { version: 1 },
                  routeKey: "",
                  safeDisplayMetadata: {},
                })
                .onConflictDoNothing();
              return { organizationId };
            })
          );
        },
        (effect) => effect.pipe(mapManagementError("connect complete"))
      );

      const listConnections = Effect.fn("DiscordConnection.listConnections")(
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
                  discordProviderKey
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
                guildId: metadata.guildId ?? null,
                guildName: metadata.guildName ?? connection.name,
                lifecycle: connection.lifecycle,
              }))
            )
          );
        },
        (effect) => effect.pipe(mapManagementError("list"))
      );

      const disconnect = Effect.fn("DiscordConnection.disconnect")(function* (
        input: S.TDiscordConnectionDisconnect
      ) {
        const { connectionId, organizationId } = input;
        const disconnectingConnection = yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockDiscordConnection(
                db,
                connectionId,
                organizationId
              );
              if (connection === undefined) {
                return yield* new NotFoundError({
                  message: "Discord connection was not found",
                });
              }
              if (connection.lifecycle === "archived") {
                return undefined;
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
              return {
                credentialsCiphertext:
                  connection.credentialsCiphertext ?? undefined,
                guildId: connection.remoteAccountId ?? undefined,
              };
            })
          )
          .pipe(mapManagementError("disconnect"));
        if (disconnectingConnection === undefined) {
          return;
        }
        if (disconnectingConnection.guildId !== undefined) {
          const leftGuild = yield* Effect.exit(
            apiClient.guildsLeave({
              botToken: config.botToken,
              guildId: disconnectingConnection.guildId,
            })
          );
          if (Exit.isFailure(leftGuild)) {
            yield* db
              .update(schema.integrationConnectionTable)
              .set({
                lifecycle: "revocation_unconfirmed",
                updatedAt: new Date(),
              })
              .where(eq(schema.integrationConnectionTable.id, connectionId))
              .pipe(mapManagementError("disconnect state update"));
            return yield* Effect.failCause(leftGuild.cause).pipe(
              mapDiscordApiError("guild disconnect")
            );
          }
        }
        const credentialsCiphertext =
          disconnectingConnection.credentialsCiphertext;
        if (credentialsCiphertext === undefined) {
          yield* Effect.logWarning(
            "Discord disconnect had no installer credential to revoke"
          );
        } else {
          const credentials = yield* Effect.exit(
            decryptConnectionCredentials(config, credentialsCiphertext)
          );
          if (Exit.isFailure(credentials)) {
            yield* Effect.logWarning(
              "Could not decrypt Discord credentials for token revocation"
            );
          } else if (credentials.value.userToken !== undefined) {
            const revoked = yield* Effect.exit(
              apiClient.oauth2TokenRevoke({
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                userToken: credentials.value.userToken,
              })
            );
            if (Exit.isFailure(revoked)) {
              yield* Effect.logWarning(
                "Discord token revocation failed after guild disconnect"
              );
            }
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
          .where(eq(schema.integrationConnectionTable.id, connectionId))
          .pipe(mapManagementError("disconnect archive"));
      });

      return DiscordConnectionService.of({
        connectComplete,
        connectStart,
        disconnect,
        listConnections,
      });
    })
  );

/** Live layer with the default fetch-backed Discord API client. */
export const DiscordConnectionServiceLive = makeDiscordConnectionServiceLive();
