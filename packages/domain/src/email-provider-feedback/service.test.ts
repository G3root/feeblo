import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailProviderFeedbackInputError } from "./schema";
import { EmailProviderFeedbackService } from "./service";

describe("EmailProviderFeedbackService", () => {
  const TestLayer = EmailProviderFeedbackService.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const makeDelivery = (
    state: "accepted" | "delivered" | "sending",
    recipientEmail = "feedback@example.com"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = new Date();
      const outboxId = `eob_${organizationId}`;
      const deliveryId = `edl_${organizationId}`;
      const messageId = `<email.${organizationId}@notifications.feeblo>`;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Provider feedback workspace",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.emailOutboxTable).values({
        id: outboxId,
        organizationId,
        kind: "submission.created",
        aggregateType: "post",
        aggregateId: "pst_feedback",
        deduplicationKey: `submission.created:${organizationId}`,
        payload: { kind: "submission.created", postId: "pst_feedback" },
        scheduledAt: now,
        expiresAt: null,
        state: "materialized",
      });
      yield* db.insert(schema.emailDeliveryTable).values({
        id: deliveryId,
        outboxId,
        contactId: null,
        recipientEmail,
        template: "submission-notification",
        templateVersion: 1,
        templatePayload: { postId: "pst_feedback" },
        messageId,
        state,
        attemptCount: 1,
        nextAttemptAt: null,
        acceptedAt: state === "accepted" ? now : null,
        deliveredAt: state === "delivered" ? now : null,
        lastError: null,
        providerMetadata: null,
      });

      return { deliveryId, messageId, outboxId };
    });

  layer(TestLayer)("service", (it) => {
    it.effect(
      "records a delivered lifecycle event and updates its correlated delivery",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery("accepted");

          const result = yield* service.ingest({
            eventId: "provider-delivered-1",
            messageId: delivery.messageId,
            metadata: {
              category: "delivery",
              providerSecret: "discarded-at-schema-boundary",
              reasonCode: "smtp_250",
            },
            occurredAt: "2026-08-09T12:00:00.000Z",
            type: "delivered",
          });

          expect(result).toMatchObject({
            _tag: "Processed",
            deliveryUpdated: true,
          });
          const [stored] = yield* db
            .select({ state: schema.emailDeliveryTable.state })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
          expect(stored?.state).toBe("delivered");
          const events = yield* db
            .select({
              id: schema.emailProviderEventTable.providerEventId,
              metadata: schema.emailProviderEventTable.metadata,
            })
            .from(schema.emailProviderEventTable)
            .where(
              eq(schema.emailProviderEventTable.deliveryId, delivery.deliveryId)
            );
          expect(events).toHaveLength(1);
          expect(events[0]?.metadata).toEqual({
            category: "delivery",
            reasonCode: "smtp_250",
          });
        })
    );

    it.effect("records deferral without creating another Feeblo delivery", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;
        const delivery = yield* makeDelivery("accepted");

        yield* service.ingest({
          eventId: "provider-deferred-1",
          messageId: delivery.messageId,
          occurredAt: "2026-08-09T12:00:00.000Z",
          type: "deferred",
        });

        const [stored] = yield* db
          .select({
            nextAttemptAt: schema.emailDeliveryTable.nextAttemptAt,
            state: schema.emailDeliveryTable.state,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
        const deliveries = yield* db
          .select({ id: schema.emailDeliveryTable.id })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.outboxId, delivery.outboxId));

        expect(stored).toMatchObject({
          nextAttemptAt: null,
          state: "accepted",
        });
        expect(deliveries).toHaveLength(1);
      })
    );

    it.effect(
      "suppresses hard bounces and treats duplicate events as harmless",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery(
            "accepted",
            "bounce-feedback@example.com"
          );
          const event = {
            bounceType: "hard" as const,
            eventId: "provider-bounce-1",
            messageId: delivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            type: "bounced" as const,
          };

          const first = yield* service.ingest(event);
          const duplicate = yield* service.ingest(event);

          expect(first).toMatchObject({ _tag: "Processed", suppressed: true });
          expect(duplicate).toEqual({ _tag: "Duplicate" });
          const [suppression] = yield* db
            .select({ reason: schema.emailSuppressionTable.reason })
            .from(schema.emailSuppressionTable)
            .where(
              eq(
                schema.emailSuppressionTable.email,
                "bounce-feedback@example.com"
              )
            );
          const events = yield* db
            .select({
              providerEventId: schema.emailProviderEventTable.providerEventId,
            })
            .from(schema.emailProviderEventTable)
            .where(
              eq(schema.emailProviderEventTable.providerEventId, event.eventId)
            );

          expect(suppression?.reason).toBe("hard_bounce");
          expect(events).toHaveLength(1);
        })
    );

    it.effect(
      "records failed and complaint events with guarded terminal outcomes",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const failedDelivery = yield* makeDelivery(
            "sending",
            "failed-feedback@example.com"
          );
          const complaintDelivery = yield* makeDelivery(
            "delivered",
            "complaint-feedback@example.com"
          );

          yield* service.ingest({
            eventId: "provider-failed-1",
            messageId: failedDelivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            type: "failed",
          });
          const complaintResult = yield* service.ingest({
            eventId: "provider-complaint-1",
            messageId: complaintDelivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            type: "complained",
          });

          const [failed] = yield* db
            .select({ state: schema.emailDeliveryTable.state })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, failedDelivery.deliveryId));
          const [complaintDeliveryState] = yield* db
            .select({ state: schema.emailDeliveryTable.state })
            .from(schema.emailDeliveryTable)
            .where(
              eq(schema.emailDeliveryTable.id, complaintDelivery.deliveryId)
            );
          const [suppression] = yield* db
            .select({ reason: schema.emailSuppressionTable.reason })
            .from(schema.emailSuppressionTable)
            .where(
              eq(
                schema.emailSuppressionTable.email,
                "complaint-feedback@example.com"
              )
            );

          expect(failed?.state).toBe("failed");
          expect(complaintResult).toMatchObject({
            _tag: "Processed",
            deliveryUpdated: false,
          });
          expect(complaintDeliveryState?.state).toBe("delivered");
          expect(suppression?.reason).toBe("complaint");
        })
    );

    it.effect(
      "rejects unknown provider lifecycle types at the schema boundary",
      () =>
        Effect.gen(function* () {
          const service = yield* EmailProviderFeedbackService;
          const error = yield* Effect.flip(
            service.ingest({
              eventId: "provider-unknown-1",
              messageId: "<email.unknown@notifications.feeblo>",
              occurredAt: "2026-08-09T12:00:00.000Z",
              type: "opened",
            })
          );

          expect(error).toBeInstanceOf(EmailProviderFeedbackInputError);
        })
    );

    it.effect(
      "acknowledges a valid provider event for an unknown message id",
      () =>
        Effect.gen(function* () {
          const service = yield* EmailProviderFeedbackService;

          expect(
            yield* service.ingest({
              eventId: "provider-unknown-message-1",
              messageId: "<email.unknown@notifications.feeblo>",
              occurredAt: "2026-08-09T12:00:00.000Z",
              type: "delivered",
            })
          ).toEqual({ _tag: "UnknownDelivery" });
        })
    );

    it.effect(
      "does not move delivery timestamps backwards for late provider events",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery("accepted");
          const currentUpdatedAt = new Date("2026-08-09T13:00:00.000Z");
          yield* db
            .update(schema.emailDeliveryTable)
            .set({ updatedAt: currentUpdatedAt })
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));

          yield* service.ingest({
            eventId: "provider-late-delivered-1",
            messageId: delivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            type: "delivered",
          });

          const [stored] = yield* db
            .select({ updatedAt: schema.emailDeliveryTable.updatedAt })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
          expect(stored?.updatedAt).toEqual(currentUpdatedAt);
        })
    );
  });
});
