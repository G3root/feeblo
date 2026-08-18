import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { asLegid, IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import {
  type DiscordApiClient,
  type DiscordChannel,
  DiscordOAuthState,
} from "@feeblo/integration-discord";
import { discordProviderKey } from "@feeblo/integration-discord/manifest";
import { isString } from "@feeblo/utils/runtime-kind";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { DiscordIntegrationConfig } from "./config";
import { makeDiscordManagementServiceLive } from "./management-live";
import { DiscordManagementService } from "./management-service";

const testChannels: readonly DiscordChannel[] = [
  { id: "C1", name: "general", type: 0 },
  { id: "C2", name: "feedback", type: 0 },
  { id: "C3", name: "announcements", type: 5 },
  { id: "V1", name: "voice", type: 2 },
  { id: "CAT1", name: "category", type: 4 },
];

/** Fake Discord API client; captures calls and answers with canned data. */
const makeFakeDiscordApiClient = (
  channels: readonly DiscordChannel[] = testChannels,
  guildId: string | ((exchangeNumber: number) => string) = "G123"
): DiscordApiClient & {
  readonly calls: { readonly method: string }[];
  readonly registeredCommands: readonly { name: string; type: number }[];
} => {
  const calls: { readonly method: string }[] = [];
  const registeredCommands: { name: string; type: number }[] = [];
  let exchangeNumber = 0;
  return {
    calls,
    registeredCommands,
    applicationsMe: () => {
      calls.push({ method: "applications.@me" });
      return Effect.succeed({ id: "A123", name: "Feeblo" });
    },
    channelsMessagesCreate: () => {
      calls.push({ method: "channels.messages.create" });
      return Effect.succeed({ channel_id: "C1", content: "", id: "M1" });
    },
    guildsChannels: () => {
      calls.push({ method: "guilds.channels" });
      return Effect.succeed([...channels]);
    },
    guildsCommandsBulkOverwrite: ({ commands }) => {
      calls.push({ method: "guilds.commands.bulkOverwrite" });
      registeredCommands.length = 0;
      registeredCommands.push(
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        ...(commands as readonly { name: string; type: number }[])
      );
      return Effect.succeed(
        commands.map((command, index) => ({
          id: `command_${index}`,
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          name: (command as { name: string }).name,
          // SAFETY: The endpoint/API contract guarantees this response shape.
          type: (command as { type: number }).type,
        }))
      );
    },
    guildsLeave: () => {
      calls.push({ method: "guilds.leave" });
      return Effect.void;
    },
    oauth2TokenExchange: () => {
      calls.push({ method: "oauth2.token" });
      exchangeNumber += 1;
      const exchangedGuildId = isString(guildId)
        ? guildId
        : guildId(exchangeNumber);
      return Effect.succeed({
        access_token: "discord-user-token",
        expires_in: 604_800,
        guild: { id: exchangedGuildId, name: "Acme" },
        scope: "identify applications.commands bot",
        token_type: "Bearer",
        user: { id: "U123", username: "alice" },
      });
    },
    oauth2TokenRevoke: () => {
      calls.push({ method: "oauth2.token.revoke" });
      return Effect.void;
    },
  };
};

const testConfig = (configured = true) =>
  DiscordIntegrationConfig.layerTest({
    botToken: Redacted.make("discord-bot-token"),
    clientId: "client-id",
    clientSecret: Redacted.make("client-secret"),
    configured,
    oauthRedirectUrl: "http://localhost:3000/discord/oauth/callback",
    publicKey: "0".repeat(64),
  });

const makeTestLayer = (
  channels?: readonly DiscordChannel[],
  configured = true,
  guildId: string | ((exchangeNumber: number) => string) = "G123"
) => {
  const apiClient = makeFakeDiscordApiClient(channels, guildId);
  const serviceLayer = makeDiscordManagementServiceLive(apiClient).pipe(
    Layer.provide(testConfig(configured)),
    Layer.provide(Database.PgliteDatabaseLive)
  );
  return {
    apiClient,
    layer: Layer.mergeAll(serviceLayer, Database.PgliteDatabaseLive),
  };
};

const seedOrganization = Effect.gen(function* () {
  const db = yield* currentDb;
  const organizationId = yield* WorkspaceId.generate;
  yield* db.insert(schema.organizationTable).values({
    createdAt: new Date(),
    id: organizationId,
    name: "Discord management test",
    slug: organizationId,
  });
  return organizationId;
});

const decodeState = (authorizeUrl: URL) => {
  const url = new URL(authorizeUrl);
  return Schema.decodeUnknownSync(Schema.fromJsonString(DiscordOAuthState))(
    url.searchParams.get("state") ?? ""
  );
};

const urlState = (authorizeUrl: URL) =>
  authorizeUrl.searchParams.get("state") ?? "";

describe("discord management service", () => {
  const connectFlow = makeTestLayer();
  layer(connectFlow.layer)("connect flow", (it) => {
    it.effect(
      "connectStart creates a pending connection and authorize URL",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* DiscordManagementService;
          const { authorizeUrl } = yield* service.connectStart({
            organizationId,
          });

          const url = new URL(authorizeUrl);
          expect(url.hostname).toBe("discord.com");
          expect(url.searchParams.get("client_id")).toBe("client-id");
          expect(url.searchParams.get("response_type")).toBe("code");
          expect(url.searchParams.get("redirect_uri")).toBe(
            "http://localhost:3000/discord/oauth/callback"
          );
          expect(url.searchParams.get("scope")).toContain("bot");
          expect(url.searchParams.get("scope")).toContain(
            "applications.commands"
          );
          expect(url.searchParams.get("permissions")).toBe("84992");

          const state = decodeState(authorizeUrl);
          expect(state.organizationId).toBe(organizationId);

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, state.connectionId)
            );
          expect(connection?.lifecycle).toBe("connecting");
          expect(connection?.credentialsCiphertext).not.toBeNull();
        })
    );

    it.effect(
      "connectComplete exchanges the code, registers commands, and activates the connection",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* DiscordManagementService;
          const { authorizeUrl } = yield* service.connectStart({
            organizationId,
          });
          const state = decodeState(new URL(authorizeUrl));

          const result = yield* service.connectComplete({
            code: "oauth-code",
            state: urlState(new URL(authorizeUrl)),
          });
          expect(result.organizationId).toBe(organizationId);

          // Guild-scoped commands are registered as part of the install.
          expect(
            connectFlow.apiClient.registeredCommands.map(
              (command) => command.name
            )
          ).toEqual(["feeblo", "Send to Feeblo"]);

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, state.connectionId)
            );
          expect(connection?.lifecycle).toBe("active");
          expect(connection?.remoteAccountId).toBe("G123");
          expect(connection?.name).toBe("Acme");
          expect(connection?.safeDisplayMetadata).toMatchObject({
            guildId: "G123",
            guildName: "Acme",
            installerUserId: "U123",
          });

          const routes = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, state.connectionId)
            );
          expect(routes.map((route) => route.capabilityKey)).toEqual([
            "interactions",
          ]);
        })
    );

    it.effect("connectComplete rejects a mismatched state nonce", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedOrganization;
        const service = yield* DiscordManagementService;
        const started = yield* service.connectStart({ organizationId });
        const startedState = decodeState(started.authorizeUrl);
        const bogus = yield* Schema.encodeEffect(
          Schema.fromJsonString(DiscordOAuthState)
        )({
          connectionId: startedState.connectionId,
          nonce: "wrong",
          organizationId,
        });
        const failure = yield* Effect.flip(
          service.connectComplete({ code: "code", state: bogus })
        );
        expect(failure).toMatchObject({
          _tag: "BadRequestError",
          message: "Discord OAuth state does not match",
        });
      })
    );
  });

  layer(makeTestLayer(undefined, true, "GUILD_OWNERSHIP").layer)(
    "guild ownership",
    (it) => {
      it.effect("rejects connecting one guild to two organizations", () =>
        Effect.gen(function* () {
          const service = yield* DiscordManagementService;
          const firstOrganizationId = yield* seedOrganization;
          const first = yield* service.connectStart({
            organizationId: firstOrganizationId,
          });
          yield* service.connectComplete({
            code: "first-code",
            state: urlState(first.authorizeUrl),
          });

          const secondOrganizationId = yield* seedOrganization;
          const second = yield* service.connectStart({
            organizationId: secondOrganizationId,
          });
          const failure = yield* Effect.flip(
            service.connectComplete({
              code: "second-code",
              state: urlState(second.authorizeUrl),
            })
          );

          expect(failure).toMatchObject({
            _tag: "BadRequestError",
            message:
              "Discord server is already connected to another organization",
          });
        })
      );
    }
  );

  const channelNotificationsFlow = makeTestLayer(
    undefined,
    true,
    (exchangeNumber) => `GUILD_CHANNELS_${exchangeNumber}`
  );
  layer(channelNotificationsFlow.layer)("channel notifications", (it) => {
    it.effect("lists text channels and toggles notifications", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* seedOrganization;
        const service = yield* DiscordManagementService;
        const { authorizeUrl } = yield* service.connectStart({
          organizationId,
        });
        yield* service.connectComplete({
          code: "code",
          state: urlState(new URL(authorizeUrl)),
        });
        const [connection] = yield* db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(
                schema.integrationConnectionTable.organizationId,
                organizationId
              ),
              eq(schema.integrationConnectionTable.provider, discordProviderKey)
            )
          )
          .limit(1);
        if (connection === undefined) {
          throw new Error("expected connection");
        }
        const connectionId = asLegid(IntegrationConnectionId)(connection.id);

        const channels = yield* service.listChannels({
          connectionId,
          organizationId,
        });
        // Voice channels and categories are filtered out; only text and
        // announcement channels are selectable.
        expect(channels.map((channel) => channel.id).sort()).toEqual([
          "C1",
          "C2",
          "C3",
        ]);
        expect(
          channels.find((channel) => channel.id === "C1")?.notificationsEnabled
        ).toBe(false);

        yield* service.setChannelNotifications({
          channelId: "C2",
          connectionId,
          enabled: true,
          organizationId,
        });
        const updated = yield* service.listChannels({
          connectionId,
          organizationId,
        });
        expect(
          updated.find((channel) => channel.id === "C2")?.notificationsEnabled
        ).toBe(true);
        expect(
          updated.find((channel) => channel.id === "C1")?.notificationsEnabled
        ).toBe(false);

        yield* service.setChannelNotifications({
          channelId: "C2",
          connectionId,
          enabled: false,
          organizationId,
        });
        const disabled = yield* service.listChannels({
          connectionId,
          organizationId,
        });
        expect(
          disabled.find((channel) => channel.id === "C2")?.notificationsEnabled
        ).toBe(false);

        const unknownChannelFailure = yield* Effect.flip(
          service.setChannelNotifications({
            channelId: "CHANNEL_FROM_ANOTHER_GUILD",
            connectionId,
            enabled: true,
            organizationId,
          })
        );
        expect(unknownChannelFailure).toMatchObject({
          _tag: "NotFoundError",
          message: "Discord channel was not found in the connected server",
        });
      })
    );

    it.effect("disconnect archives the connection and revokes the token", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* seedOrganization;
        const service = yield* DiscordManagementService;
        const { authorizeUrl } = yield* service.connectStart({
          organizationId,
        });
        yield* service.connectComplete({
          code: "code",
          state: urlState(new URL(authorizeUrl)),
        });
        const [connection] = yield* db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(
                schema.integrationConnectionTable.organizationId,
                organizationId
              ),
              eq(schema.integrationConnectionTable.provider, discordProviderKey)
            )
          )
          .limit(1);
        if (connection === undefined) {
          throw new Error("expected connection");
        }

        yield* service.disconnect({
          connectionId: asLegid(IntegrationConnectionId)(connection.id),
          organizationId,
        });

        const [archived] = yield* db
          .select()
          .from(schema.integrationConnectionTable)
          .where(eq(schema.integrationConnectionTable.id, connection.id));
        expect(archived?.lifecycle).toBe("archived");
        expect(archived?.credentialsCiphertext).toBeNull();

        const listed = yield* service.listConnections({ organizationId });
        expect(listed).toHaveLength(0);
        expect(
          channelNotificationsFlow.apiClient.calls.some(
            (call) => call.method === "guilds.leave"
          )
        ).toBe(true);
      })
    );
  });

  layer(makeTestLayer(undefined, false).layer)(
    "unconfigured deployment",
    (it) => {
      it.effect("connectStart fails when Discord is not configured", () =>
        Effect.gen(function* () {
          const organizationId = yield* seedOrganization;
          const service = yield* DiscordManagementService;
          const result = yield* Effect.exit(
            service.connectStart({ organizationId })
          );
          expect(Exit.isFailure(result)).toBe(true);
        })
      );
    }
  );
});
