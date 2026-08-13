import { createHmac } from "node:crypto";
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
import { describe, expect, it } from "vitest";
import type { SlackApiClient } from "./slack-api";
import { slackProviderKey } from "./slack-manifest";
import { makeSlackProviderRegistration } from "./slack-provider-registration";

const signingSecret = Redacted.make("signing-secret");

const deliveryInput = (
  overrides: Partial<IntegrationProviderDeliveryInput> = {}
): IntegrationProviderDeliveryInput => ({
  connection: {
    credentialGeneration: 1,
    id: asLegid(IntegrationConnectionId)("conn_1"),
    lifecycleStatus: "active",
    name: "Acme",
    organizationId: asLegid(WorkspaceId)("org_1"),
    provider: slackProviderKey,
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
    capabilityKey: "channel.notifications",
    configVersion: 1,
    connectionId: asLegid(IntegrationConnectionId)("conn_1"),
    enabled: true,
    eventTypes: ["feedback.post.created"],
    id: asLegid(IntegrationRouteId)("route_1"),
    provider: slackProviderKey,
    providerConfig: { channelId: "C123", channelName: "feedback", version: 1 },
    safeMetadata: { channelName: "feedback" },
  },
  ...overrides,
});

const credentialResolver = {
  loadSlackCredentials: () =>
    Effect.succeed({ botToken: Redacted.make("xoxb-test-token") }),
};

const makePostMessageSpy = () => {
  let lastCall:
    | {
        readonly blocks: readonly unknown[];
        readonly channelId: string;
        readonly text: string;
      }
    | undefined;
  const ok = () => Effect.succeed({ ok: true as const });
  const apiClient: SlackApiClient = {
    authRevoke: ok,
    authTest: () =>
      Effect.succeed({
        ok: true as const,
        team: "Acme",
        team_id: "T123",
        url: "https://acme.slack.com/",
        user: "U123",
        user_id: "U123",
      }),
    chatPostEphemeral: ok,
    chatPostMessage: ({ blocks, channelId, text }) => {
      lastCall = { blocks, channelId, text };
      return ok();
    },
    conversationsJoin: ok,
    conversationsList: () =>
      Effect.succeed({ channels: [], ok: true as const }),
    oauthV2Access: () =>
      Effect.succeed({
        access_token: "xoxb-token",
        app_id: "A123",
        bot_user_id: "B123",
        ok: true as const,
        team: { id: "T123", name: "Acme" },
        token_type: "bot",
      }),
    teamInfo: () =>
      Effect.succeed({ ok: true as const, team: { id: "T123", name: "Acme" } }),
    usersInfo: () =>
      Effect.succeed({ ok: true as const, user: { id: "U1", name: "alice" } }),
    viewsOpen: ok,
  };
  return { apiClient, getLastCall: () => lastCall };
};

describe("slack provider registration", () => {
  it("posts channel-update blocks for feedback.post.created deliveries", async () => {
    const spy = makePostMessageSpy();
    const registration = makeSlackProviderRegistration({
      apiClient: spy.apiClient,
      credentialResolver,
      signingSecret,
    });
    const handler = registration.handlers.find(
      (candidate) => candidate.capabilityKey === "channel.notifications"
    );
    expect(handler).toBeDefined();

    const result = await Effect.runPromiseExit(
      handler?.deliver(deliveryInput()) ?? Effect.never
    );
    expect(Exit.isSuccess(result)).toBe(true);

    const call = spy.getLastCall();
    expect(call?.channelId).toBe("C123");
    expect(call?.text).toBe("Dark mode please");
    const header = call?.blocks[0] as { text: { text: string } };
    expect(header.text.text).toBe("Dark mode please");
  });

  it("rejects unsupported event types as invalid configuration", async () => {
    const spy = makePostMessageSpy();
    const registration = makeSlackProviderRegistration({
      apiClient: spy.apiClient,
      credentialResolver,
      signingSecret,
    });
    const handler = registration.handlers[0];
    const result = await Effect.runPromiseExit(
      handler?.deliver(
        deliveryInput({
          event: {
            ...deliveryInput().event,
            type: "feedback.post.status_changed",
          },
        })
      ) ?? Effect.never
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) && result.cause).toBeDefined();
  });

  it("classifies a missing bot token as invalid configuration", async () => {
    const spy = makePostMessageSpy();
    const registration = makeSlackProviderRegistration({
      apiClient: spy.apiClient,
      credentialResolver: {
        loadSlackCredentials: () =>
          Effect.fail(
            new IntegrationProviderInvalidConfigurationError({
              message: "no credentials",
              provider: slackProviderKey,
            })
          ),
      },
      signingSecret,
    });
    const handler = registration.handlers[0];
    const result = await Effect.runPromiseExit(
      handler?.deliver(deliveryInput()) ?? Effect.never
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("verifies inbound signatures before parsing", async () => {
    const registration = makeSlackProviderRegistration({
      credentialResolver,
      signingSecret,
    });
    const commands = registration.inboundHandlers.find(
      (candidate) => candidate.capabilityKey === "commands"
    );
    expect(commands).toBeDefined();

    const rawBody =
      "team_id=T123&user_id=U123&text=hello&command=%2Ffeeblo&channel_id=C1&channel_name=general&user_name=alice&token=token&trigger_id=trig&response_url=https%3A%2F%2Fhooks.slack.com%2Fx&team_domain=acme";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", Redacted.value(signingSecret))
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const response = await Effect.runPromise(
      commands?.handle({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        rawBody,
      }) ?? Effect.never
    );
    expect(response.status).toBe(200);
    const parsed = response.body as { kind: string; payload: { text: string } };
    expect(parsed.kind).toBe("slash_command");
    expect(parsed.payload.text).toBe("hello");
  });

  it("rejects unsigned inbound requests", async () => {
    const registration = makeSlackProviderRegistration({
      credentialResolver,
      signingSecret,
    });
    const commands = registration.inboundHandlers.find(
      (candidate) => candidate.capabilityKey === "commands"
    );
    const response = await Effect.runPromise(
      commands?.handle({
        headers: {},
        rawBody: "team_id=T123",
      }) ?? Effect.never
    );
    expect(response.status).toBe(401);
  });

  it("parses form-encoded interactive payloads (view submissions)", async () => {
    const registration = makeSlackProviderRegistration({
      credentialResolver,
      signingSecret,
    });
    const interactive = registration.inboundHandlers.find(
      (candidate) => candidate.capabilityKey === "message.action"
    );
    expect(interactive).toBeDefined();

    const payload = {
      type: "view_submission",
      team: { id: "T123", domain: "acme" },
      user: { id: "U123", name: "alice" },
      view: {
        id: "V123",
        callback_id: "feeblo_feedback_modal",
        private_metadata: '{"channelId":"C1"}',
        state: { values: {} },
      },
    };
    // Slack delivers interactive payloads as `payload=<urlencoded JSON>`.
    const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", Redacted.value(signingSecret))
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const response = await Effect.runPromise(
      interactive?.handle({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        rawBody,
      }) ?? Effect.never
    );
    expect(response.status).toBe(200);
    const parsed = response.body as { kind: string; payload: { type: string } };
    expect(parsed.kind).toBe("interactive");
    expect(parsed.payload.type).toBe("view_submission");
  });

  it("accepts raw JSON interactive payloads", async () => {
    const registration = makeSlackProviderRegistration({
      credentialResolver,
      signingSecret,
    });
    const interactive = registration.inboundHandlers.find(
      (candidate) => candidate.capabilityKey === "message.action"
    );
    const payload = {
      type: "message_action",
      callback_id: "send_to_feeblo",
      team: { id: "T123", domain: "acme" },
      user: { id: "U123", name: "alice" },
      channel: { id: "C1", name: "general" },
      message: { type: "message", text: "hello", ts: "1.2" },
      trigger_id: "trigger",
      response_url: "https://hooks.slack.com/x",
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", Redacted.value(signingSecret))
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const response = await Effect.runPromise(
      interactive?.handle({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        rawBody,
      }) ?? Effect.never
    );
    expect(response.status).toBe(200);
    const parsed = response.body as { kind: string; payload: { type: string } };
    expect(parsed.payload.type).toBe("message_action");
  });
});
