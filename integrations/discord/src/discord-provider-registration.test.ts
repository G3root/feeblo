import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import {
  asLegid,
  IntegrationConnectionId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  WorkspaceId,
} from "@feeblo/id";
import {
  type IntegrationProviderDeliveryInput,
  IntegrationProviderInvalidConfigurationError,
} from "@feeblo/integration-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import type { DiscordApiClient } from "./discord-api";
import {
  discordChannelNotificationsCapabilityKey,
  discordProviderKey,
} from "./discord-manifest";
import { makeDiscordProviderRegistration } from "./discord-provider-registration";

// Discord interaction signatures are Ed25519; the test keypair is generated
// inline so no fixture secret is needed.
const { publicKeyHex, privateKeyHex } = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyHex: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex"),
    privateKeyHex: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("hex"),
  };
})();

const signBody = (timestamp: string, rawBody: string) =>
  sign(
    null,
    Buffer.from(`${timestamp}${rawBody}`),
    createPrivateKey({
      key: Buffer.from(privateKeyHex, "hex"),
      format: "der",
      type: "pkcs8",
    })
  ).toString("hex");

const signedHeaders = (rawBody: string) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    headers: {
      "x-signature-ed25519": signBody(timestamp, rawBody),
      "x-signature-timestamp": timestamp,
    },
    rawBody,
  };
};

const deliveryInput = (
  overrides: Partial<IntegrationProviderDeliveryInput> = {}
): IntegrationProviderDeliveryInput => ({
  connection: {
    credentialGeneration: 1,
    id: asLegid(IntegrationConnectionId)("conn_1"),
    lifecycleStatus: "active",
    name: "Acme",
    organizationId: asLegid(WorkspaceId)("org_1"),
    provider: discordProviderKey,
    safeMetadata: {},
  },
  delivery: {
    actionKey: "channel.notifications:route_1",
    attemptCount: 0,
    eventId: asLegid(IntegrationEventId)("event_1"),
    id: asLegid(IntegrationDeliveryId)("delivery_1"),
    leaseExpiresAt: null,
    leaseOwner: null,
    nextAttemptAt: DateTime.makeUnsafe(new Date()),
    orderingKey: null,
    routeId: asLegid(IntegrationRouteId)("route_1"),
    state: "pending",
  },
  event: {
    causalHopCount: 0,
    correlationId: "corr_1",
    data: {
      actor: { kind: "end_user" },
      board: { id: "brd_1", name: "Ideas", slug: "ideas" },
      post: {
        id: "pst_1",
        metadata: { customer_tier: "Enterprise" },
        status: { id: "pss_1", type: "PENDING" },
        title: "Dark mode please",
        url: "https://feeblo.example/org/post/ideas/dark-mode",
      },
    },
    id: asLegid(IntegrationEventId)("event_1"),
    occurredAt: DateTime.makeUnsafe(new Date("2026-08-12T00:00:00.000Z")),
    organizationId: asLegid(WorkspaceId)("org_1"),
    origin: { kind: "feeblo" },
    type: "feedback.post.created",
    version: 1,
  },
  route: {
    capabilityKey: discordChannelNotificationsCapabilityKey,
    configVersion: 1,
    connectionId: asLegid(IntegrationConnectionId)("conn_1"),
    enabled: true,
    eventTypes: ["feedback.post.created"],
    id: asLegid(IntegrationRouteId)("route_1"),
    provider: discordProviderKey,
    providerConfig: { channelId: "123456789012345678", version: 1 },
    safeMetadata: { channelName: "feedback" },
  },
  ...overrides,
});

const credentialResolver = {
  loadDiscordCredentials: () =>
    Effect.succeed({ botToken: Redacted.make("discord-bot-token") }),
};

const makePostMessageSpy = () => {
  let lastCall:
    | {
        readonly channelId: string;
        readonly embeds: readonly unknown[];
      }
    | undefined;
  const apiClient: DiscordApiClient = {
    applicationsMe: () => Effect.succeed({ id: "app_1", name: "Feeblo" }),
    channelsMessagesCreate: ({ channelId, embeds }) => {
      lastCall = { channelId, embeds };
      return Effect.succeed({
        channel_id: channelId,
        content: "",
        id: "message_1",
      });
    },
    guildsChannels: () => Effect.succeed([]),
    guildsCommandsBulkOverwrite: () => Effect.succeed([]),
    guildsLeave: () => Effect.void,
    oauth2TokenExchange: () =>
      Effect.succeed({
        access_token: "user-token",
        expires_in: 604_800,
        guild: { id: "guild_1", name: "Acme" },
        scope: "identify applications.commands bot",
        token_type: "Bearer",
      }),
    oauth2TokenRevoke: () => Effect.void,
  };
  return { apiClient, getLastCall: () => lastCall };
};

describe("discord provider registration", () => {
  it.effect(
    "posts a channel-update embed for feedback.post.created deliveries",
    () =>
      Effect.gen(function* () {
        const spy = makePostMessageSpy();
        const registration = makeDiscordProviderRegistration({
          apiClient: spy.apiClient,
          credentialResolver,
          publicKey: publicKeyHex,
        });
        const handler = registration.handlers.find(
          (candidate) => candidate.capabilityKey === "channel.notifications"
        );
        expect(handler).toBeDefined();
        if (handler === undefined) {
          return;
        }

        const result = yield* Effect.exit(handler.deliver(deliveryInput()));
        expect(Exit.isSuccess(result)).toBe(true);

        const call = spy.getLastCall();
        expect(call?.channelId).toBe("123456789012345678");
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        const embed = call?.embeds[0] as {
          description: string;
          title: string;
          url: string;
        };
        expect(embed.title).toBe("Dark mode please");
        expect(embed.description).toContain("**Customer Tier:** Enterprise");
        expect(embed.url).toBe(
          "https://feeblo.example/org/post/ideas/dark-mode"
        );
      })
  );

  it.effect("rejects unsupported event types as invalid configuration", () =>
    Effect.gen(function* () {
      const spy = makePostMessageSpy();
      const registration = makeDiscordProviderRegistration({
        apiClient: spy.apiClient,
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const handler = registration.handlers[0];
      expect(handler).toBeDefined();
      if (handler === undefined) {
        return;
      }
      const failure = yield* Effect.flip(
        handler.deliver(
          deliveryInput({
            event: {
              ...deliveryInput().event,
              type: "feedback.post.status_changed",
            },
          })
        )
      );
      expect(failure._tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );

  it.effect("classifies a missing bot token as invalid configuration", () =>
    Effect.gen(function* () {
      const spy = makePostMessageSpy();
      const registration = makeDiscordProviderRegistration({
        apiClient: spy.apiClient,
        credentialResolver: {
          loadDiscordCredentials: () =>
            Effect.fail(
              new IntegrationProviderInvalidConfigurationError({
                message: "no credentials",
                provider: discordProviderKey,
              })
            ),
        },
        publicKey: publicKeyHex,
      });
      const handler = registration.handlers[0];
      expect(handler).toBeDefined();
      if (handler === undefined) {
        return;
      }
      const failure = yield* Effect.flip(handler.deliver(deliveryInput()));
      expect(failure._tag).toBe("IntegrationProviderInvalidConfigurationError");
    })
  );

  it.effect("verifies inbound signatures and parses application commands", () =>
    Effect.gen(function* () {
      const registration = makeDiscordProviderRegistration({
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const interactions = registration.inboundHandlers.find(
        (candidate) => candidate.capabilityKey === "interactions"
      );
      expect(interactions).toBeDefined();

      const rawBody = JSON.stringify({
        id: "interaction_1",
        application_id: "app_1",
        type: 2,
        data: {
          id: "command_1",
          name: "feeblo",
          type: 1,
          options: [{ name: "text", type: 3, value: "Dark mode please" }],
        },
        guild_id: "guild_1",
        channel_id: "channel_1",
        member: { user: { id: "user_1", username: "alice" } },
        token: "token_1",
      });

      const response = yield* (
        interactions?.handle(signedHeaders(rawBody)) ?? Effect.never
      );
      expect(response.status).toBe(200);
      // SAFETY: The endpoint/API contract guarantees this response shape.
      const parsed = response.body as {
        kind: string;
        payload: { data: { name: string } };
      };
      expect(parsed.kind).toBe("application_command");
      expect(parsed.payload.data.name).toBe("feeblo");
    })
  );

  it.effect("parses ping interactions", () =>
    Effect.gen(function* () {
      const registration = makeDiscordProviderRegistration({
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const interactions = registration.inboundHandlers.find(
        (candidate) => candidate.capabilityKey === "interactions"
      );
      const rawBody = JSON.stringify({ id: "ping_1", type: 1 });
      const response = yield* (
        interactions?.handle(signedHeaders(rawBody)) ?? Effect.never
      );
      // SAFETY: The endpoint/API contract guarantees this response shape.
      expect(response.status).toBe(200);
      // SAFETY: The endpoint/API contract guarantees this response shape.
      const parsed = response.body as { kind: string };
      expect(parsed.kind).toBe("ping");
    })
  );

  it.effect("parses modal submissions", () =>
    Effect.gen(function* () {
      const registration = makeDiscordProviderRegistration({
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const interactions = registration.inboundHandlers.find(
        (candidate) => candidate.capabilityKey === "interactions"
      );
      const rawBody = JSON.stringify({
        id: "interaction_2",
        application_id: "app_1",
        type: 5,
        data: {
          custom_id: "feeblo:org_1:guild_1:channel_1",
          components: [
            {
              type: 18,
              component: { type: 4, custom_id: "title", value: "Dark mode" },
            },
            {
              type: 18,
              component: { type: 4, custom_id: "details", value: "Please" },
            },
            {
              type: 18,
              component: { type: 3, custom_id: "board", values: ["brd_1"] },
            },
          ],
        },
        guild_id: "guild_1",
        channel_id: "channel_1",
        member: { user: { id: "user_1", username: "alice" } },
        token: "token_2",
      });
      const response = yield* (
        interactions?.handle(signedHeaders(rawBody)) ?? Effect.never
        // SAFETY: The endpoint/API contract guarantees this response shape.
      );
      // SAFETY: The endpoint/API contract guarantees this response shape.
      expect(response.status).toBe(200);
      // SAFETY: The endpoint/API contract guarantees this response shape.
      const parsed = response.body as { kind: string };
      expect(parsed.kind).toBe("modal_submit");
    })
  );

  it.effect("rejects unsigned inbound requests", () =>
    Effect.gen(function* () {
      const registration = makeDiscordProviderRegistration({
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const interactions = registration.inboundHandlers.find(
        (candidate) => candidate.capabilityKey === "interactions"
      );
      const response = yield* (
        interactions?.handle({
          headers: {},
          rawBody: JSON.stringify({ type: 1 }),
        }) ?? Effect.never
      );
      expect(response.status).toBe(401);
    })
  );

  it.effect("rejects malformed JSON inbound requests", () =>
    Effect.gen(function* () {
      const registration = makeDiscordProviderRegistration({
        credentialResolver,
        publicKey: publicKeyHex,
      });
      const interactions = registration.inboundHandlers.find(
        (candidate) => candidate.capabilityKey === "interactions"
      );
      const response = yield* (
        interactions?.handle(signedHeaders("not-json")) ?? Effect.never
      );
      expect(response.status).toBe(400);
    })
  );
});
