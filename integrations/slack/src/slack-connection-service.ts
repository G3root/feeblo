import { currentDb, type Database, schema } from "@feeblo/db";
import { SlackIntegrationConfig } from "@feeblo/domain/integration/slack/config";
import type { SlackIntegrationError } from "@feeblo/domain/integration/slack/errors";
import type * as S from "@feeblo/domain/integration/slack/schema";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "@feeblo/domain/rpc-errors";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationRouteId,
} from "@feeblo/id";
import {
  makeSlackApiClient,
  SLACK_OAUTH_AUTHORIZE_URL,
  type SlackApiClient,
  SlackOAuthState,
} from "@feeblo/integration-slack";
import {
  decryptSlackCredentialMaterial,
  encryptSlackCredentialMaterial,
} from "@feeblo/integration-slack/credentials";
import {
  slackCommandsCapabilityKey,
  slackMessageActionCapabilityKey,
  slackProviderKey,
} from "@feeblo/integration-slack/manifest";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  decryptConnectionCredentials,
  lockSlackConnection,
  mapManagementError,
  mapSlackApiError,
} from "./slack-management-shared";

const retentionMs = 30 * 24 * 60 * 60 * 1000;

const SlackSafeDisplayMetadata = Schema.Struct({
  teamId: Schema.optionalKey(Schema.String),
  teamName: Schema.optionalKey(Schema.String),
  botUserId: Schema.optionalKey(Schema.String),
});

const decodeSafeDisplayMetadata = (value: Schema.Json) =>
  Schema.decodeUnknownEffect(SlackSafeDisplayMetadata)(value ?? {}).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Stored Slack display metadata is invalid",
        })
    )
  );

/**
 * OAuth connection lifecycle: installing a Slack workspace (connect start and
 * completion), listing connections, and disconnecting with credential erasure.
 */
export interface SlackConnectionServiceContract {
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
  readonly listConnections: (
    input: S.TSlackConnectionList
  ) => Effect.Effect<readonly S.TSlackConnection[], SlackIntegrationError>;
}

export class SlackConnectionService extends Context.Service<
  SlackConnectionService,
  SlackConnectionServiceContract
>()("@feeblo/SlackConnectionService") {}

/** Creates the Slack connection lifecycle service with an injectable API client. */
export const makeSlackConnectionServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackConnectionService,
  never,
  Database.Database | SlackIntegrationConfig
> =>
  Layer.effect(
    SlackConnectionService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* SlackIntegrationConfig;

      const connectStart = Effect.fn("SlackConnection.connectStart")(
        function* ({ organizationId }: S.TSlackConnectStart) {
          if (!config.configured) {
            return yield* new InternalServerError({
              message: "Slack integration is not configured",
            });
          }
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
                      slackProviderKey
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
                name: "Slack",
                organizationId,
                provider: slackProviderKey,
                safeDisplayMetadata: {},
              });
            })
          );
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

      const connectComplete = Effect.fn("SlackConnection.connectComplete")(
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
          // OAuth exchange runs before any transaction: the code is single-use,
          // so Slack itself serializes replays. The guarded connection
          // transition below is the idempotency boundary for concurrent
          // callback replays.
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
              ...(oauth.authed_user?.access_token !== undefined && {
                userToken: oauth.authed_user.access_token,
              }),
              ...(oauth.incoming_webhook?.url !== undefined && {
                incomingWebhookUrl: oauth.incoming_webhook.url,
              }),
            }
          ).pipe(
            Effect.mapError(
              () =>
                new InternalServerError({
                  message: "Slack credentials could not be encrypted",
                })
            )
          );
          return yield* db.transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockSlackConnection(
                db,
                decoded.connectionId,
                decoded.organizationId
              );
              if (
                connection === undefined ||
                connection.lifecycle !== "connecting"
              ) {
                return yield* new NotFoundError({
                  message: "Slack connection was not found",
                });
              }
              if (connection.credentialsCiphertext === null) {
                return yield* new NotFoundError({
                  message: "Slack connection was not found",
                });
              }
              const credentials = yield* decryptConnectionCredentials(
                config,
                connection.credentialsCiphertext
              );
              if (credentials.oauthState !== decoded.nonce) {
                return yield* new BadRequestError({
                  message: "Slack OAuth state does not match",
                });
              }
              const now = new Date();
              // A Slack workspace has at most one active connection per
              // organization: archive any pre-existing active connection for
              // the same team before activating the current row, so
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
                      decoded.organizationId
                    ),
                    eq(
                      schema.integrationConnectionTable.provider,
                      slackProviderKey
                    ),
                    eq(
                      schema.integrationConnectionTable.remoteAccountId,
                      authTest.team_id
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
              // Duplicate replays are ignored via the connection/capability
              // unique index.
              for (const capabilityKey of [
                slackCommandsCapabilityKey,
                slackMessageActionCapabilityKey,
              ]) {
                yield* db
                  .insert(schema.integrationRouteTable)
                  .values({
                    capabilityKey,
                    configVersion: 1,
                    connectionId: connection.id,
                    enabled: true,
                    eventTypes: [],
                    id: yield* IntegrationRouteId.generate,
                    organizationId: decoded.organizationId,
                    providerConfig: { version: 1 },
                    routeKey: "",
                    safeDisplayMetadata: {},
                  })
                  .onConflictDoNothing();
              }
              return { organizationId: decoded.organizationId };
            })
          );
        },
        (effect) => effect.pipe(mapManagementError("connect complete"))
      );

      const listConnections = Effect.fn("SlackConnection.listConnections")(
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

      const disconnect = Effect.fn("SlackConnection.disconnect")(function* (
        input: S.TSlackConnectionDisconnect
      ) {
        const { connectionId, organizationId } = input;
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const [connection] = yield* lockSlackConnection(
                db,
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

      return SlackConnectionService.of({
        connectComplete,
        connectStart,
        disconnect,
        listConnections,
      });
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackConnectionServiceLive = makeSlackConnectionServiceLive();
