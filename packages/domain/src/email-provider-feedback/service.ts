import { currentDb, schema } from "@feeblo/db";
import { EmailDeliveryState } from "@feeblo/db/validation-schema/email";
import { EmailDeliveryId } from "@feeblo/id";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { deliverySourceStatesFor } from "../email-outbox/delivery-state";
import { recordEmailDeliveryTransition } from "../email-outbox/telemetry";
import { EmailAddress } from "../email-subscription/schema";
import {
  EmailProviderFeedbackDataError,
  EmailProviderFeedbackInputError,
  type ProviderLifecycleEvent as LifecycleEvent,
  ProviderLifecycleEvent,
} from "./schema";

const DeliveryCorrelationRecord = Schema.Struct({
  id: EmailDeliveryId.schema,
  messageId: Schema.String,
  recipientEmail: EmailAddress,
  state: EmailDeliveryState,
});

type DeliveryCorrelationRecord = Schema.Schema.Type<
  typeof DeliveryCorrelationRecord
>;

const inputError = (
  operation: string,
  reason: string
): EmailProviderFeedbackInputError =>
  new EmailProviderFeedbackInputError({
    message: `Email provider feedback input failed during ${operation}: ${reason}`,
    operation,
    reason,
  });

const dataError = (
  operation: string,
  reason: string
): EmailProviderFeedbackDataError =>
  new EmailProviderFeedbackDataError({
    message: `Email provider feedback persistence failed during ${operation}: ${reason}`,
    operation,
    reason,
  });

const decodeLifecycleEvent = (
  input: LifecycleEvent | Schema.Json
): Effect.Effect<LifecycleEvent, EmailProviderFeedbackInputError> =>
  Schema.decodeUnknownEffect(ProviderLifecycleEvent)(input).pipe(
    Effect.mapError(() =>
      inputError(
        "ingest.decodeLifecycleEvent",
        "Provider lifecycle event is invalid"
      )
    )
  );

const decodeDelivery = (
  input: Schema.Json
): Effect.Effect<DeliveryCorrelationRecord, EmailProviderFeedbackDataError> =>
  Schema.decodeUnknownEffect(DeliveryCorrelationRecord)(input).pipe(
    Effect.mapError(() =>
      dataError(
        "ingest.decodeDelivery",
        "Stored delivery correlation record is invalid"
      )
    )
  );

const makeEmailProviderFeedbackService = Effect.gen(function* () {
  const db = yield* currentDb;

  const ingest = Effect.fn("EmailProviderFeedbackService.ingest")(function* (
    input: LifecycleEvent | Schema.Json
  ) {
    const event = yield* decodeLifecycleEvent(input);

    return yield* db.transaction(() =>
      Effect.gen(function* () {
        const [storedDelivery] = yield* db
          .select({
            id: schema.emailDeliveryTable.id,
            messageId: schema.emailDeliveryTable.messageId,
            recipientEmail: schema.emailDeliveryTable.recipientEmail,
            state: schema.emailDeliveryTable.state,
          })
          .from(schema.emailDeliveryTable)
          .where(eq(schema.emailDeliveryTable.messageId, event.messageId))
          .limit(1);

        if (storedDelivery === undefined) {
          return { _tag: "UnknownDelivery" as const };
        }
        const delivery = yield* decodeDelivery(storedDelivery);

        const [insertedEvent] = yield* db
          .insert(schema.emailProviderEventTable)
          .values({
            providerEventId: event.eventId,
            deliveryId: delivery.id,
            type: event.type,
            occurredAt: event.occurredAt,
            metadata: event.metadata ?? {},
          })
          .onConflictDoNothing({
            target: schema.emailProviderEventTable.providerEventId,
          })
          .returning({
            providerEventId: schema.emailProviderEventTable.providerEventId,
          });

        if (insertedEvent === undefined) {
          return { _tag: "Duplicate" as const };
        }

        const transitionDelivery = (
          nextState: "delivered" | "deferred" | "bounced" | "failed"
        ) =>
          db
            .update(schema.emailDeliveryTable)
            .set({
              state: nextState,
              ...(nextState === "delivered" && { deliveredAt: event.occurredAt }),
              updatedAt: sql`greatest(${schema.emailDeliveryTable.updatedAt}, ${event.occurredAt})`,
            })
            .where(
              and(
                eq(schema.emailDeliveryTable.id, delivery.id),
                inArray(
                  schema.emailDeliveryTable.state,
                  deliverySourceStatesFor(nextState)
                )
              )
            )
            .returning({ id: schema.emailDeliveryTable.id })
            .pipe(Effect.map((rows) => rows.length === 1));

        const suppress = (reason: "hard_bounce" | "complaint") =>
          db
            .insert(schema.emailSuppressionTable)
            .values({
              email: delivery.recipientEmail,
              reason,
              providerEventId: event.eventId,
            })
            .onConflictDoUpdate({
              target: schema.emailSuppressionTable.email,
              set: {
                reason,
                providerEventId: event.eventId,
              },
            })
            .pipe(Effect.as(true));

        switch (event.type) {
          case "delivered": {
            const deliveryUpdated = yield* transitionDelivery("delivered");
            yield* recordEmailDeliveryTransition(
              "delivered",
              deliveryUpdated ? 1 : 0
            );
            return {
              _tag: "Processed" as const,
              deliveryUpdated,
              suppressed: false,
            };
          }
          case "deferred": {
            // Provider deferral is observable only. Feeblo must not queue a
            // second send while the provider may still be attempting delivery.
            yield* recordEmailDeliveryTransition("deferred");
            return {
              _tag: "Processed" as const,
              deliveryUpdated: false,
              suppressed: false,
            };
          }
          case "bounced": {
            const deliveryUpdated = yield* transitionDelivery("bounced");
            yield* recordEmailDeliveryTransition(
              "bounced",
              deliveryUpdated ? 1 : 0
            );
            const suppressed =
              event.bounceType === "hard"
                ? yield* suppress("hard_bounce")
                : false;
            if (event.bounceType === "hard") {
              yield* Effect.logWarning(
                "Email provider hard-bounce alert signal"
              ).pipe(
                Effect.annotateLogs({
                  deliveryId: delivery.id,
                  providerEventId: event.eventId,
                })
              );
            }
            return { _tag: "Processed" as const, deliveryUpdated, suppressed };
          }
          case "failed": {
            const deliveryUpdated = yield* transitionDelivery("failed");
            yield* recordEmailDeliveryTransition(
              "failed",
              deliveryUpdated ? 1 : 0
            );
            return {
              _tag: "Processed" as const,
              deliveryUpdated,
              suppressed: false,
            };
          }
          case "complained": {
            const deliveryUpdated = yield* transitionDelivery("failed");
            yield* recordEmailDeliveryTransition(
              "complained",
              deliveryUpdated ? 1 : 0
            );
            const suppressed = yield* suppress("complaint");
            yield* Effect.logWarning(
              "Email provider complaint alert signal"
            ).pipe(
              Effect.annotateLogs({
                deliveryId: delivery.id,
                providerEventId: event.eventId,
              })
            );
            return { _tag: "Processed" as const, deliveryUpdated, suppressed };
          }
          default:
            return event satisfies never;
        }
      })
    );
  });

  return { ingest };
});

export class EmailProviderFeedbackService extends Context.Service<EmailProviderFeedbackService>()(
  "EmailProviderFeedbackService",
  {
    make: makeEmailProviderFeedbackService,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
