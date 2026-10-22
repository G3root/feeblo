import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { and, eq, isNull } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailProviderFeedbackInputError } from "./schema";
import { EmailProviderFeedbackService } from "./service";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

describe("EmailProviderFeedbackService", () => {
  const TestLayer = EmailProviderFeedbackService.layer.pipe(
    Layer.provideMerge(Database.PgliteDatabaseLive)
  );

  const makeDelivery = (
    state: "accepted" | "delivered" | "sending",
    recipientEmail = "feedback@example.com",
    attemptCount = 1
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const now = yield* DateTime.nowAsDate;
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
        attemptCount,
        nextAttemptAt: null,
        acceptedAt: state === "accepted" ? now : null,
        deliveredAt: state === "delivered" ? now : null,
        lastError: null,
        providerMetadata: null,
      });

      return { deliveryId, messageId, organizationId, outboxId };
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
            recipients: ["feedback@example.com"],
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
          recipients: ["feedback@example.com"],
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
      "suppresses hard bounces for the workspace that observed them and treats duplicate events as harmless",
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
            recipients: ["bounce-feedback@example.com"],
            type: "bounced" as const,
          };

          const first = yield* service.ingest(event);
          const duplicate = yield* service.ingest(event);

          expect(first).toMatchObject({ _tag: "Processed", suppressed: true });
          expect(duplicate).toEqual({ _tag: "Duplicate" });
          const [suppression] = yield* db
            .select({
              firstReason: schema.emailSuppressionTable.firstReason,
              organizationId: schema.emailSuppressionTable.organizationId,
              reason: schema.emailSuppressionTable.reason,
            })
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

          expect(suppression).toMatchObject({
            firstReason: "hard_bounce",
            organizationId: delivery.organizationId,
            reason: "hard_bounce",
          });
          expect(events).toHaveLength(1);
        })
    );

    it.effect(
      "suppresses a hard bounce whose Message-ID cannot be correlated",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;

          const result = yield* service.ingest({
            bounceType: "hard",
            eventId: "provider-uncorrelated-bounce-1",
            messageId: "<unknown@notifications.feeblo>",
            occurredAt: "2026-08-09T12:00:00.000Z",
            recipients: ["Unknown-Recipient@Example.com"],
            type: "bounced",
          });

          expect(result).toEqual({
            _tag: "UnknownDelivery",
            suppressed: true,
          });
          const [suppression] = yield* db
            .select({
              firstReason: schema.emailSuppressionTable.firstReason,
              organizationId: schema.emailSuppressionTable.organizationId,
              reason: schema.emailSuppressionTable.reason,
            })
            .from(schema.emailSuppressionTable)
            .where(
              eq(
                schema.emailSuppressionTable.email,
                "unknown-recipient@example.com"
              )
            );
          expect(suppression).toMatchObject({
            firstReason: "hard_bounce",
            organizationId: null,
            reason: "hard_bounce",
          });
        })
    );

    it.effect(
      "does not let an uncorrelated complaint silence every workspace",
      () =>
        Effect.gen(function* () {
          const service = yield* EmailProviderFeedbackService;

          expect(
            yield* service.ingest({
              eventId: "provider-uncorrelated-complaint-1",
              messageId: "<unknown@notifications.feeblo>",
              occurredAt: "2026-08-09T12:00:00.000Z",
              recipients: ["unattributed-complaint@example.com"],
              type: "complained",
            })
          ).toEqual({ _tag: "UnknownDelivery", suppressed: false });
        })
    );

    it.effect(
      "correlates by delivery id when the Message-ID was rewritten",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery(
            "accepted",
            "rewritten-header@example.com"
          );

          const result = yield* service.ingest({
            bounceType: "hard",
            deliveryId: delivery.deliveryId,
            eventId: "provider-rewritten-header-1",
            messageId: "<rewritten-by-the-relay@elsewhere.example>",
            occurredAt: "2026-08-09T12:00:00.000Z",
            recipients: ["rewritten-header@example.com"],
            type: "bounced",
          });

          expect(result).toMatchObject({ _tag: "Processed", suppressed: true });
          const [suppression] = yield* db
            .select({
              organizationId: schema.emailSuppressionTable.organizationId,
            })
            .from(schema.emailSuppressionTable)
            .where(
              eq(
                schema.emailSuppressionTable.email,
                "rewritten-header@example.com"
              )
            );
          expect(suppression?.organizationId).toBe(delivery.organizationId);
        })
    );

    it.effect("defers a soft bounce and never suppresses the address", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;
        const delivery = yield* makeDelivery(
          "accepted",
          "mailbox-full@example.com"
        );

        const result = yield* service.ingest({
          bounceType: "soft",
          eventId: "provider-soft-bounce-1",
          messageId: delivery.messageId,
          metadata: { category: "MailboxFull" },
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["mailbox-full@example.com"],
          type: "bounced",
        });

        expect(result).toMatchObject({
          _tag: "Processed",
          deliveryUpdated: true,
          suppressed: false,
        });
        const [stored] = yield* db
          .select({
            nextAttemptAt: schema.emailDeliveryTable.nextAttemptAt,
            state: schema.emailDeliveryTable.state,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
        expect(stored?.state).toBe("deferred");
        expect(stored?.nextAttemptAt?.toISOString()).toBe(
          "2026-08-09T18:00:00.000Z"
        );
        const suppressions = yield* db
          .select({ email: schema.emailSuppressionTable.email })
          .from(schema.emailSuppressionTable)
          .where(
            eq(schema.emailSuppressionTable.email, "mailbox-full@example.com")
          );
        expect(suppressions).toHaveLength(0);
      })
    );

    it.effect("defers an undetermined bounce instead of suppressing it", () =>
      Effect.gen(function* () {
        const service = yield* EmailProviderFeedbackService;
        const delivery = yield* makeDelivery(
          "accepted",
          "undetermined@example.com"
        );

        const result = yield* service.ingest({
          bounceType: "undetermined",
          eventId: "provider-undetermined-1",
          messageId: delivery.messageId,
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["undetermined@example.com"],
          type: "bounced",
        });

        expect(result).toMatchObject({
          _tag: "Processed",
          deliveryUpdated: true,
          suppressed: false,
        });
      })
    );

    it.effect("fails a soft bounce once the attempt budget is spent", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;
        const delivery = yield* makeDelivery(
          "accepted",
          "exhausted@example.com",
          5
        );

        const result = yield* service.ingest({
          bounceType: "soft",
          eventId: "provider-exhausted-bounce-1",
          messageId: delivery.messageId,
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["exhausted@example.com"],
          type: "bounced",
        });

        expect(result).toMatchObject({
          _tag: "Processed",
          deliveryUpdated: true,
          suppressed: false,
        });
        const [stored] = yield* db
          .select({ state: schema.emailDeliveryTable.state })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
        expect(stored?.state).toBe("failed");
      })
    );

    it.effect(
      "keeps the original reason when a complaint follows a hard bounce",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery(
            "accepted",
            "precedence@example.com"
          );

          yield* service.ingest({
            bounceType: "hard",
            eventId: "provider-precedence-bounce-1",
            messageId: delivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            recipients: ["precedence@example.com"],
            type: "bounced",
          });
          yield* service.ingest({
            eventId: "provider-precedence-complaint-1",
            messageId: delivery.messageId,
            occurredAt: "2026-08-09T13:00:00.000Z",
            recipients: ["precedence@example.com"],
            type: "complained",
          });

          const [suppression] = yield* db
            .select({
              firstReason: schema.emailSuppressionTable.firstReason,
              reason: schema.emailSuppressionTable.reason,
            })
            .from(schema.emailSuppressionTable)
            .where(
              and(
                eq(
                  schema.emailSuppressionTable.email,
                  "precedence@example.com"
                ),
                eq(
                  schema.emailSuppressionTable.organizationId,
                  delivery.organizationId
                )
              )
            );
          expect(suppression).toMatchObject({
            firstReason: "hard_bounce",
            reason: "complaint",
          });
        })
    );

    it.effect("records failed events with guarded terminal outcomes", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;
        const failedDelivery = yield* makeDelivery(
          "sending",
          "failed-feedback@example.com"
        );

        yield* service.ingest({
          eventId: "provider-failed-1",
          messageId: failedDelivery.messageId,
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["failed-feedback@example.com"],
          type: "failed",
        });

        const [failed] = yield* db
          .select({ state: schema.emailDeliveryTable.state })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.id, failedDelivery.deliveryId));
        expect(failed?.state).toBe("failed");
      })
    );

    it.effect("suppresses a complaint for the delivery's workspace", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;
        const complaintDelivery = yield* makeDelivery(
          "delivered",
          "complaint-feedback@example.com"
        );

        const complaintResult = yield* service.ingest({
          eventId: "provider-complaint-1",
          messageId: complaintDelivery.messageId,
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["complaint-feedback@example.com"],
          type: "complained",
        });

        const [complaintDeliveryState] = yield* db
          .select({ state: schema.emailDeliveryTable.state })
          .from(schema.emailDeliveryTable)
          .where(
            eq(schema.emailDeliveryTable.id, complaintDelivery.deliveryId)
          );
        const [suppression] = yield* db
          .select({
            organizationId: schema.emailSuppressionTable.organizationId,
            reason: schema.emailSuppressionTable.reason,
          })
          .from(schema.emailSuppressionTable)
          .where(
            eq(
              schema.emailSuppressionTable.email,
              "complaint-feedback@example.com"
            )
          );

        // A complaint is only written for the sender it is about, so it is
        // workspace-scoped rather than a platform row.
        expect(complaintResult).toMatchObject({
          _tag: "Processed",
          deliveryUpdated: false,
        });
        expect(complaintDeliveryState?.state).toBe("delivered");
        expect(suppression).toMatchObject({
          organizationId: complaintDelivery.organizationId,
          reason: "complaint",
        });
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
              recipients: ["unknown@example.com"],
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
              recipients: ["unknown@example.com"],
              type: "delivered",
            })
          ).toEqual({ _tag: "UnknownDelivery", suppressed: false });
        })
    );

    it.effect(
      "does not move delivery timestamps backwards for late provider events",
      () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const service = yield* EmailProviderFeedbackService;
          const delivery = yield* makeDelivery("accepted");
          const currentUpdatedAt = dateAt("2026-08-09T13:00:00.000Z");
          yield* db
            .update(schema.emailDeliveryTable)
            .set({ updatedAt: currentUpdatedAt })
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));

          yield* service.ingest({
            eventId: "provider-late-delivered-1",
            messageId: delivery.messageId,
            occurredAt: "2026-08-09T12:00:00.000Z",
            recipients: ["feedback@example.com"],
            type: "delivered",
          });

          const [stored] = yield* db
            .select({ updatedAt: schema.emailDeliveryTable.updatedAt })
            .from(schema.emailDeliveryTable)
            .where(eq(schema.emailDeliveryTable.id, delivery.deliveryId));
          expect(stored?.updatedAt).toEqual(currentUpdatedAt);
        })
    );

    it.effect("keeps platform rows out of a workspace's scope", () =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const service = yield* EmailProviderFeedbackService;

        yield* service.ingest({
          bounceType: "hard",
          eventId: "provider-platform-bounce-1",
          messageId: "<platform@notifications.feeblo>",
          occurredAt: "2026-08-09T12:00:00.000Z",
          recipients: ["platform-only@example.com"],
          type: "bounced",
        });

        const [row] = yield* db
          .select({
            organizationId: schema.emailSuppressionTable.organizationId,
          })
          .from(schema.emailSuppressionTable)
          .where(
            and(
              eq(
                schema.emailSuppressionTable.email,
                "platform-only@example.com"
              ),
              isNull(schema.emailSuppressionTable.organizationId)
            )
          );
        expect(row?.organizationId).toBeNull();
      })
    );
  });
});
