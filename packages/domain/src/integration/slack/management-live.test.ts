import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { asLegid, IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import {
  IntegrationProviderPermanentRejection,
  type SlackApiClient,
  type SlackConversation,
  SlackOAuthState,
} from "@feeblo/integration-slack";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { SlackIntegrationConfig } from "./config";
import { makeSlackManagementServiceLive } from "./management-live";
import { SlackManagementService } from "./management-service";

/** Fake Slack API client; captures calls and answers with canned data. */
const makeFakeSlackApiClient = (
  channelPages: readonly (readonly SlackConversation[])[] = [
    [
      {
        id: "C1",
        is_archived: false,
        is_member: true,
        is_private: false,
        name: "general",
      },
      {
        id: "C2",
        is_archived: false,
        is_member: true,
        is_private: false,
        name: "feedback",
      },
      {
        id: "C3",
        is_archived: false,
        is_member: false,
        is_private: false,
        name: "other",
      },
      {
        id: "C4",
        is_archived: false,
        is_member: false,
        is_private: true,
        name: "secret",
      },
    ],
  ]
): SlackApiClient & {
  readonly calls: { readonly method: string }[];
  readonly failOAuth: { enabled: boolean; message: string };
} => {
  const calls: { readonly method: string }[] = [];
  const failOAuth = { enabled: false, message: "invalid_code" };
  const ok = (method: string) => {
    calls.push({ method });
    return Effect.succeed({ ok: true as const });
  };
  return {
    calls,
    failOAuth,
    authRevoke: () => ok("auth.revoke"),
    authTest: () => {
      calls.push({ method: "auth.test" });
      return Effect.succeed({
        bot_id: "B123",
        ok: true as const,
        team: "Acme",
        team_id: "T123",
        url: "https://acme.slack.com/",
        user: "U123",
        user_id: "U123",
      });
    },
    chatPostEphemeral: () => ok("chat.postEphemeral"),
    chatPostMessage: () => ok("chat.postMessage"),
    conversationsJoin: () => ok("conversations.join"),
    conversationsList: ({ cursor }) => {
      calls.push({ method: "conversations.list" });
      const pageIndex = cursor === undefined ? 0 : Number(cursor) + 1;
      const page = channelPages[pageIndex] ?? [];
      const hasMore = pageIndex + 1 < channelPages.length;
      return Effect.succeed({
        channels: [...page],
        ok: true as const,
        ...(hasMore && { response_metadata: { next_cursor: String(pageIndex) } }),
      });
    },
    oauthV2Access: () => {
      calls.push({ method: "oauth.v2.access" });
      if (failOAuth.enabled) {
        return Effect.fail(
          new IntegrationProviderPermanentRejection({
            message: failOAuth.message,
            provider: slackProviderKey,
          })
        );
      }
      return Effect.succeed({
        access_token: "xoxb-bot-token",
        app_id: "A123",
        authed_user: { id: "U123", token_type: "user" },
        bot_user_id: "B123",
        ok: true as const,
        team: { id: "T123", name: "Acme" },
        token_type: "bot",
      });
    },
    teamInfo: () =>
      Effect.succeed({
        ok: true as const,
        team: { id: "T123", name: "Acme" },
      }),
    usersInfo: () => Effect.succeed({ ok: true as const, user: { id: "U1" } }),
    viewsOpen: () => ok("views.open"),
  };
};

const testConfig = (configured = true) =>
  SlackIntegrationConfig.layerTest({
    clientId: "client-id",
    clientSecret: Redacted.make("client-secret"),
    configured,
    oauthRedirectUrl: "http://localhost:3000/slack/oauth/callback",
    signingSecret: Redacted.make("signing-secret"),
  });

const makeTestLayer = (
  channelPages?: readonly (readonly SlackConversation[])[],
  configured = true
) => {
  const apiClient = makeFakeSlackApiClient(channelPages);
  const serviceLayer = makeSlackManagementServiceLive(apiClient).pipe(
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
    name: "Slack management test",
    slug: organizationId,
  });
  return organizationId;
});

const decodeState = (authorizeUrl: URL) => {
  const url = new URL(authorizeUrl);
  return Schema.decodeUnknownSync(Schema.fromJsonString(SlackOAuthState))(
    url.searchParams.get("state") ?? ""
  );
};

describe("slack management service", () => {
  layer(makeTestLayer().layer)("connect flow", (it) => {
    it.effect(
      "connectStart creates a pending connection and authorize URL",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* SlackManagementService;
          const { authorizeUrl } = yield* service.connectStart({
            organizationId,
          });

          const url = new URL(authorizeUrl);
          expect(url.hostname).toBe("slack.com");
          expect(url.searchParams.get("client_id")).toBe("client-id");
          expect(url.searchParams.get("redirect_uri")).toBe(
            "http://localhost:3000/slack/oauth/callback"
          );
          expect(url.searchParams.get("scope")).toContain("chat:write");

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
      "connectComplete exchanges the code and activates the connection with routes",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* SlackManagementService;
          const { authorizeUrl } = yield* service.connectStart({
            organizationId,
          });
          const state = decodeState(new URL(authorizeUrl));

          const result = yield* service.connectComplete({
            code: "oauth-code",
            state: urlState(authorizeUrl),
          });
          expect(result.organizationId).toBe(organizationId);

          const [connection] = yield* db
            .select()
            .from(schema.integrationConnectionTable)
            .where(
              eq(schema.integrationConnectionTable.id, state.connectionId)
            );
          expect(connection?.lifecycle).toBe("active");
          expect(connection?.remoteAccountId).toBe("T123");
          expect(connection?.name).toBe("Acme");
          expect(connection?.safeDisplayMetadata).toMatchObject({
            teamId: "T123",
            teamName: "Acme",
          });

          const routes = yield* db
            .select()
            .from(schema.integrationRouteTable)
            .where(
              eq(schema.integrationRouteTable.connectionId, state.connectionId)
            );
          expect(routes.map((route) => route.capabilityKey).sort()).toEqual([
            "commands",
            "message.action",
          ]);
        })
    );

    it.effect("connectComplete rejects a mismatched state nonce", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedOrganization;
        const service = yield* SlackManagementService;
        yield* service.connectStart({ organizationId });
        const bogus = yield* Schema.encodeEffect(
          Schema.fromJsonString(SlackOAuthState)
        )({
          connectionId: yield* IntegrationConnectionId.generate,
          nonce: "wrong",
          organizationId,
        });
        const result = yield* Effect.exit(
          service.connectComplete({ code: "code", state: bogus })
        );
        expect(Exit.isFailure(result)).toBe(true);
      })
    );
  });

  layer(makeTestLayer().layer)("channel notifications", (it) => {
    it.effect("lists member channels and toggles notifications", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* seedOrganization;
        const service = yield* SlackManagementService;
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
              eq(schema.integrationConnectionTable.provider, slackProviderKey)
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
        // All visible channels are returned; membership is reported so the
        // UI can hint that private/non-member channels need the bot added.
        expect(channels.map((channel) => channel.id).sort()).toEqual([
          "C1",
          "C2",
          "C3",
          "C4",
        ]);
        expect(channels.find((channel) => channel.id === "C3")?.isMember).toBe(
          false
        );
        expect(channels.find((channel) => channel.id === "C1")?.isMember).toBe(
          true
        );
        // Privacy comes from Slack's `is_private`, not the channel id prefix:
        // a C-prefixed id can still be a private channel.
        expect(channels.find((channel) => channel.id === "C4")?.isPrivate).toBe(
          true
        );
        expect(channels.find((channel) => channel.id === "C1")?.isPrivate).toBe(
          false
        );

        yield* service.setChannelNotifications({
          channelId: "C2",
          channelName: "feedback",
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
          channelName: "feedback",
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
      })
    );

    it.effect("disconnect archives the connection and revokes the token", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const organizationId = yield* seedOrganization;
        const service = yield* SlackManagementService;
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
              eq(schema.integrationConnectionTable.provider, slackProviderKey)
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
      })
    );
  });

  layer(
    makeTestLayer([
      [
        {
          id: "C1",
          is_archived: false,
          is_member: true,
          is_private: false,
          name: "general",
        },
        {
          id: "C2",
          is_archived: false,
          is_member: true,
          is_private: false,
          name: "feedback",
        },
      ],
      [
        {
          id: "C3",
          is_archived: false,
          is_member: false,
          is_private: false,
          name: "other",
        },
      ],
    ]).layer
  )("channel listing pagination", (it) => {
    it.effect(
      "accumulates channels across pages until the cursor is empty",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const organizationId = yield* seedOrganization;
          const service = yield* SlackManagementService;
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
                eq(schema.integrationConnectionTable.provider, slackProviderKey)
              )
            )
            .limit(1);
          if (connection === undefined) {
            throw new Error("expected connection");
          }
          const channels = yield* service.listChannels({
            connectionId: asLegid(IntegrationConnectionId)(connection.id),
            organizationId,
          });
          expect(channels.map((channel) => channel.id).sort()).toEqual([
            "C1",
            "C2",
            "C3",
          ]);
        })
    );
  });
  layer(makeTestLayer(undefined, false).layer)(
    "unconfigured deployment",
    (it) => {
      it.effect("connectStart fails when Slack is not configured", () =>
        Effect.gen(function* () {
          const organizationId = yield* seedOrganization;
          const service = yield* SlackManagementService;
          const result = yield* Effect.exit(
            service.connectStart({ organizationId })
          );
          expect(Exit.isFailure(result)).toBe(true);
        })
      );
    }
  );
});

import { and } from "drizzle-orm";
import * as Exit from "effect/Exit";

const urlState = (authorizeUrl: URL) =>
  authorizeUrl.searchParams.get("state") ?? "";
