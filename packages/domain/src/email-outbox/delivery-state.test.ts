import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  canTransitionDelivery,
  isTerminalDeliveryState,
} from "./delivery-state";
import { EmailOutboxRepository } from "./repository";

describe("email delivery state", () => {
  const TestLayer = EmailOutboxRepository.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  layer(TestLayer)("repository", (it) => {
    it("allows only valid lifecycle transitions", () => {
      expect(canTransitionDelivery("queued", "sending")).toBe(true);
      expect(canTransitionDelivery("delivered", "sending")).toBe(false);
      expect(isTerminalDeliveryState("delivered")).toBe(true);
      expect(isTerminalDeliveryState("deferred")).toBe(false);
    });

    it.effect("creates one normalized recipient delivery and lets one claimant send it", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* EmailOutboxRepository;
        const organizationId = yield* WorkspaceId.generate;

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Delivery state workspace",
          slug: organizationId,
          createdAt: new Date(),
        });
        const intent = yield* repository.recordIntent({
          aggregateId: "pst_delivery",
          aggregateType: "post",
          deduplicationKey: `submission.created:${organizationId}:pst_delivery`,
          expiresAt: null,
          kind: "submission.created",
          organizationId,
          payload: { kind: "submission.created", postId: "pst_delivery" },
          scheduledAt: new Date(),
        });
        if (intent._tag !== "Inserted") {
          expect(intent).toEqual({ _tag: "Inserted" });
          return;
        }

        const created = yield* repository.createDelivery({
          outboxId: intent.intent.id,
          recipientEmail: " Admin@Example.com ",
          template: "submission-notification",
          templatePayload: { postId: "pst_delivery" },
          templateVersion: 1,
        });
        const duplicate = yield* repository.createDelivery({
          outboxId: intent.intent.id,
          recipientEmail: "admin@example.com",
          template: "submission-notification",
          templatePayload: { postId: "pst_delivery" },
          templateVersion: 1,
        });

        expect(created._tag).toBe("Inserted");
        expect(duplicate).toEqual({ _tag: "Duplicate" });
        if (created._tag !== "Inserted") {
          expect(created).toEqual({ _tag: "Inserted" });
          return;
        }
        expect(created.delivery.recipientEmail).toBe("admin@example.com");
        expect(created.delivery.messageId).toMatch(/^<email\.[a-f0-9]{64}@notifications\.feeblo>$/);

        const claims = yield* Effect.all(
          [
            repository.claimDeliveryForSending({
              id: created.delivery.id,
              now: new Date(),
            }),
            repository.claimDeliveryForSending({
              id: created.delivery.id,
              now: new Date(),
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect(claims.filter((claimed) => claimed)).toHaveLength(1);
      })
    );

    it.effect("does not revive a terminal delivery when work is replayed", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const repository = yield* EmailOutboxRepository;
        const organizationId = yield* WorkspaceId.generate;

        yield* db.insert(schema.organizationTable).values({
          id: organizationId,
          name: "Terminal delivery workspace",
          slug: organizationId,
          createdAt: new Date(),
        });
        const intent = yield* repository.recordIntent({
          aggregateId: "pst_terminal",
          aggregateType: "post",
          deduplicationKey: `submission.created:${organizationId}:pst_terminal`,
          expiresAt: null,
          kind: "submission.created",
          organizationId,
          payload: { kind: "submission.created", postId: "pst_terminal" },
          scheduledAt: new Date(),
        });
        if (intent._tag !== "Inserted") {
          expect(intent).toEqual({ _tag: "Inserted" });
          return;
        }
        const delivery = yield* repository.createDelivery({
          outboxId: intent.intent.id,
          recipientEmail: "terminal@example.com",
          template: "submission-notification",
          templatePayload: { postId: "pst_terminal" },
          templateVersion: 1,
        });
        if (delivery._tag !== "Inserted") {
          expect(delivery).toEqual({ _tag: "Inserted" });
          return;
        }

        yield* repository.claimDeliveryForSending({
          id: delivery.delivery.id,
          now: new Date(),
        });
        const firstDelivery = yield* repository.markDeliveryDelivered({
          id: delivery.delivery.id,
          deliveredAt: new Date(),
        });
        const repeatedDelivery = yield* repository.markDeliveryDelivered({
          id: delivery.delivery.id,
          deliveredAt: new Date(),
        });
        const replayClaim = yield* repository.claimDeliveryForSending({
          id: delivery.delivery.id,
          now: new Date(),
        });

        expect(firstDelivery).toBe(true);
        expect(repeatedDelivery).toBe(false);
        expect(replayClaim).toBe(false);
      })
    );
  });
});
