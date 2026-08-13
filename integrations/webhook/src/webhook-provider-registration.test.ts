import { describe, expect, it } from "@effect/vitest";
import {
  BoardId,
  IntegrationConnectionId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  MemberId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import {
  type IntegrationProviderDeliveryInput,
  makeIntegrationProviderRegistry,
} from "@feeblo/integration-core";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Webhook } from "standardwebhooks";
import { startTestServer } from "./test-server";
import { webhookProviderKey } from "./webhook-manifest";
import { WebhookExternalPayload } from "./webhook-payload";
import { makeWebhookProviderRegistration } from "./webhook-provider-registration";

const secret = Redacted.make(
  "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
);

const makeRegistration = (endpointUrl: URL) =>
  makeWebhookProviderRegistration({
    credentialResolver: {
      loadWebhookCredentials: () =>
        Effect.succeed({
          endpointUrl: Redacted.make(endpointUrl.toString()),
          signingKeyring: { current: secret },
        }),
    },
    endpointSecurityPolicy: {
      allowPrivateNetworkInDevelopment: true,
      environment: "development",
    },
  });

const makeDeliveryFixture = () =>
  Effect.gen(function* () {
    const boardId = yield* BoardId.generate;
    const connectionId = yield* IntegrationConnectionId.generate;
    const deliveryId = yield* IntegrationDeliveryId.generate;
    const eventId = yield* IntegrationEventId.generate;
    const memberId = yield* MemberId.generate;
    const organizationId = yield* WorkspaceId.generate;
    const postId = yield* PostId.generate;
    const routeId = yield* IntegrationRouteId.generate;
    const statusId = yield* PostStatusId.generate;
    const now = DateTime.makeUnsafe(new Date());
    const input: IntegrationProviderDeliveryInput = {
      connection: {
        credentialGeneration: 1,
        id: connectionId,
        lifecycleStatus: "active",
        name: "Test endpoint",
        organizationId,
        provider: webhookProviderKey,
        safeMetadata: { hostname: "127.0.0.1" },
      },
      delivery: {
        actionKey: "test-action",
        attemptCount: 1,
        eventId,
        id: deliveryId,
        leaseExpiresAt: now,
        leaseOwner: "test-worker",
        nextAttemptAt: now,
        orderingKey: null,
        routeId,
        state: "leased",
      },
      event: {
        causalHopCount: 0,
        correlationId: eventId,
        data: {
          actor: {
            displayName: "Ada",
            kind: "member",
            memberId,
          },
          board: { id: boardId, name: "Feedback", slug: "feedback" },
          post: {
            id: postId,
            status: { id: statusId, type: "PENDING" },
            title: "Canonical post",
            url: "https://app.example.test/org/post/feedback/canonical-post",
          },
        },
        id: eventId,
        occurredAt: now,
        organizationId,
        origin: { kind: "feeblo" },
        type: "feedback.post.created",
        version: 1,
      },
      route: {
        capabilityKey: "events.post",
        configVersion: 1,
        connectionId,
        enabled: true,
        eventTypes: ["feedback.post.created"],
        id: routeId,
        provider: webhookProviderKey,
        providerConfig: {},
        safeMetadata: {},
      },
    };
    return {
      boardId,
      input,
      memberId,
      now,
      postId,
      statusId,
    };
  });

describe("webhook provider registration", () => {
  it("is accepted by the real core startup registry", () => {
    const registration = makeWebhookProviderRegistration({
      endpointSecurityPolicy: {
        environment: "test",
        allowPrivateNetworkInDevelopment: false,
      },
      credentialResolver: {
        loadWebhookCredentials: () =>
          Effect.succeed({
            endpointUrl: Redacted.make("https://example.com/hook"),
            signingKeyring: {
              current: Redacted.make(
                "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
              ),
            },
          }),
      },
    });
    const registry = Effect.runSync(
      makeIntegrationProviderRegistry([registration])
    );
    expect(
      registry.getHandler({
        provider: webhookProviderKey,
        capabilityKey: "events.post",
      })
    ).toBeDefined();
  });

  it.live(
    "delivers canonical post data and signs the exact external wire payload",
    () =>
      Effect.gen(function* () {
        let receiveRequest: (request: {
          readonly body: string;
          readonly headers: Record<string, string | string[] | undefined>;
        }) => void = () => undefined;
        const received = new Promise<{
          readonly body: string;
          readonly headers: Record<string, string | string[] | undefined>;
        }>((resolve) => {
          receiveRequest = resolve;
        });
        const endpointUrl = yield* startTestServer((request, response) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            receiveRequest({
              body: Buffer.concat(chunks).toString("utf8"),
              headers: request.headers,
            });
            response.writeHead(204).end();
          });
        });
        const { boardId, input, memberId, now, postId, statusId } =
          yield* makeDeliveryFixture();
        const handler = makeRegistration(endpointUrl).handlers[0];
        if (handler === undefined) {
          throw new Error("Expected a webhook delivery handler");
        }

        const result = yield* handler.deliver(input);
        expect(result).toEqual({ httpStatus: 204 });
        const request = yield* Effect.tryPromise(() => received);
        const decodedRequest = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(WebhookExternalPayload)
        )(request.body);
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.headers["x-feeblo-event"]).toBe("feedback.post.created");
        expect(decodedRequest).toEqual({
          actor: { displayName: "Ada", memberId, type: "member" },
          board: { id: boardId, name: "Feedback", slug: "feedback" },
          id: input.event.id,
          occurredAt: now.toString(),
          organizationId: input.event.organizationId,
          post: {
            id: postId,
            title: "Canonical post",
            url: "https://app.example.test/org/post/feedback/canonical-post",
          },
          status: { id: statusId, type: "PENDING" },
          type: "feedback.post.created",
          version: 1,
        });
        expect(
          new Webhook(Redacted.value(secret)).verify(request.body, {
            "webhook-id": String(request.headers["webhook-id"]),
            "webhook-signature": String(request.headers["webhook-signature"]),
            "webhook-timestamp": String(request.headers["webhook-timestamp"]),
          })
        ).toEqual(decodedRequest);
      })
  );

  it.live("maps a retryable 500 receiver response to a temporary failure", () =>
    Effect.gen(function* () {
      const endpointUrl = yield* startTestServer((_request, response) =>
        response.writeHead(500).end()
      );
      const { input } = yield* makeDeliveryFixture();
      const handler = makeRegistration(endpointUrl).handlers[0];
      if (handler === undefined) {
        throw new Error("Expected a webhook delivery handler");
      }

      const failure = yield* Effect.flip(handler.deliver(input));
      expect(failure).toMatchObject({
        _tag: "IntegrationProviderTemporaryFailure",
        httpStatus: 500,
      });
    })
  );

  it.live(
    "maps a terminal 400 receiver response to a permanent rejection",
    () =>
      Effect.gen(function* () {
        const endpointUrl = yield* startTestServer((_request, response) =>
          response.writeHead(400).end()
        );
        const { input } = yield* makeDeliveryFixture();
        const handler = makeRegistration(endpointUrl).handlers[0];
        if (handler === undefined) {
          throw new Error("Expected a webhook delivery handler");
        }

        const failure = yield* Effect.flip(handler.deliver(input));
        expect(failure).toMatchObject({
          _tag: "IntegrationProviderPermanentRejection",
          httpStatus: 400,
        });
      })
  );

  it.live("maps a 429 response with Retry-After to a rate-limit failure", () =>
    Effect.gen(function* () {
      const endpointUrl = yield* startTestServer((_request, response) =>
        response.writeHead(429, { "retry-after": "120" }).end()
      );
      const { input } = yield* makeDeliveryFixture();
      const handler = makeRegistration(endpointUrl).handlers[0];
      if (handler === undefined) {
        throw new Error("Expected a webhook delivery handler");
      }

      const failure = yield* Effect.flip(handler.deliver(input));
      expect(failure).toMatchObject({
        _tag: "IntegrationProviderRateLimitedError",
        httpStatus: 429,
        retryAfterMs: 120_000,
      });
    })
  );
});
