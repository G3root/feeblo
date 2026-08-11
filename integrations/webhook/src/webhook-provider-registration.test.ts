import { createServer } from "node:http";
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
import { describe, expect, it } from "vitest";
import { webhookProviderKey } from "./webhook-manifest";
import { WebhookExternalPayload } from "./webhook-payload";
import { makeWebhookProviderRegistration } from "./webhook-provider-registration";

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

  it("maps canonical post data and signs the exact external wire payload", async () => {
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
    const server = createServer((request, response) => {
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
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).toBe("object");
      if (address === null || typeof address !== "object") {
        return;
      }
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          return {
            boardId: yield* BoardId.generate,
            connectionId: yield* IntegrationConnectionId.generate,
            deliveryId: yield* IntegrationDeliveryId.generate,
            eventId: yield* IntegrationEventId.generate,
            memberId: yield* MemberId.generate,
            organizationId: yield* WorkspaceId.generate,
            postId: yield* PostId.generate,
            routeId: yield* IntegrationRouteId.generate,
            statusId: yield* PostStatusId.generate,
          };
        })
      );
      const now = DateTime.makeUnsafe(new Date());
      const secret = Redacted.make(
        "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
      );
      const input: IntegrationProviderDeliveryInput = {
        connection: {
          credentialGeneration: 1,
          id: ids.connectionId,
          lifecycleStatus: "active",
          name: "Test endpoint",
          organizationId: ids.organizationId,
          provider: webhookProviderKey,
          safeMetadata: { hostname: "127.0.0.1" },
        },
        delivery: {
          actionKey: "test-action",
          attemptCount: 1,
          eventId: ids.eventId,
          id: ids.deliveryId,
          leaseExpiresAt: now,
          leaseOwner: "test-worker",
          nextAttemptAt: now,
          orderingKey: null,
          routeId: ids.routeId,
          state: "leased",
        },
        event: {
          causalHopCount: 0,
          correlationId: ids.eventId,
          data: {
            actor: {
              displayName: "Ada",
              kind: "member",
              memberId: ids.memberId,
            },
            board: { id: ids.boardId, name: "Feedback", slug: "feedback" },
            post: {
              id: ids.postId,
              status: { id: ids.statusId, type: "PENDING" },
              title: "Canonical post",
              url: "https://app.example.test/org/post/feedback/canonical-post",
            },
          },
          id: ids.eventId,
          occurredAt: now,
          organizationId: ids.organizationId,
          origin: { kind: "feeblo" },
          type: "feedback.post.created",
          version: 1,
        },
        route: {
          capabilityKey: "events.post",
          configVersion: 1,
          connectionId: ids.connectionId,
          enabled: true,
          eventTypes: ["feedback.post.created"],
          id: ids.routeId,
          provider: webhookProviderKey,
          safeMetadata: {},
        },
      };
      const registration = makeWebhookProviderRegistration({
        credentialResolver: {
          loadWebhookCredentials: () =>
            Effect.succeed({
              endpointUrl: Redacted.make(
                `http://127.0.0.1:${address.port}/hook`
              ),
              signingKeyring: { current: secret },
            }),
        },
        endpointSecurityPolicy: {
          allowPrivateNetworkInDevelopment: true,
          environment: "development",
        },
      });
      const handler = registration.handlers[0];
      expect(handler).toBeDefined();
      if (handler === undefined) {
        return;
      }

      await Effect.runPromise(handler.deliver(input));
      const request = await received;
      const decodedRequest = await Effect.runPromise(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(WebhookExternalPayload)
        )(request.body)
      );
      expect(request.headers["x-feeblo-event"]).toBe("feedback.post.created");
      expect(decodedRequest).toEqual({
        actor: { displayName: "Ada", memberId: ids.memberId, type: "member" },
        board: { id: ids.boardId, name: "Feedback", slug: "feedback" },
        id: ids.eventId,
        occurredAt: now.toString(),
        organizationId: ids.organizationId,
        post: {
          id: ids.postId,
          title: "Canonical post",
          url: "https://app.example.test/org/post/feedback/canonical-post",
        },
        status: { id: ids.statusId, type: "PENDING" },
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
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error)
        );
      });
    }
  });
});
