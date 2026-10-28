import { currentDb, schema } from "@feeblo/db";
import { EmailDeliveryState } from "@feeblo/db/validation-schema/email";
import { EmailDeliveryId } from "@feeblo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { deliverySourceStatesFor } from "../email-outbox/delivery-state";
import { maximumDeliveryAttempts } from "../email-outbox/limits";
import { recordEmailDeliveryTransition } from "../email-outbox/telemetry";
import { EmailAddress } from "../email-subscription/schema";
import { EmailSuppressionRepository } from "../email-suppression/repository";
import {
  recordEmailProviderBounce,
  recordEmailProviderComplaint,
  recordEmailSuppression,
} from "../email-suppression/telemetry";
import {
  EmailProviderFeedbackDataError,
  EmailProviderFeedbackInputError,
  type ProviderLifecycleEvent as LifecycleEvent,
  ProviderLifecycleEvent,
} from "./schema";

const DeliveryCorrelationRecord = Schema.Struct({
  attemptCount: Schema.Int,
  id: EmailDeliveryId.schema,
  messageId: Schema.String,
  organizationId: Schema.String,
  recipientEmail: EmailAddress,
  state: EmailDeliveryState,
});

type DeliveryCorrelationRecord = Schema.Schema.Type<
  typeof DeliveryCorrelationRecord
>;

/**
 * How long a soft or undetermined bounce waits before the delivery is retried.
 *
 * A transient rejection is usually a full mailbox or a greylist, both of which
 * clear within hours; retrying sooner mostly buys another rejection. The
 * outbox expiration still wins: reconciliation expires a deferred delivery
 * whose intent is gone before it re-offers it.
 */
const softBounceRetryDelay = Duration.hours(6);

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
  const suppressions = yield* EmailSuppressionRepository;

  /**
   * Finds the delivery an event belongs to.
   *
   * Message-ID first because it is what the provider quotes in the event. The
   * `X-Feeblo-Delivery-Id` header is the second key: SES truncates the header
   * list and some relays rewrite Message-ID, and a hard bounce that cannot be
   * correlated could not suppress the address it names.
   */
  const findDelivery = (event: LifecycleEvent) =>
    Effect.gen(function* () {
      const select = {
        attemptCount: schema.emailDeliveryTable.attemptCount,
        id: schema.emailDeliveryTable.id,
        messageId: schema.emailDeliveryTable.messageId,
        organizationId: schema.emailOutboxTable.organizationId,
        recipientEmail: schema.emailDeliveryTable.recipientEmail,
        state: schema.emailDeliveryTable.state,
      } as const;
      const fromDelivery = () =>
        db
          .select(select)
          .from(schema.emailDeliveryTable)
          .innerJoin(
            schema.emailOutboxTable,
            eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId)
          );

      const [byMessageId] = yield* fromDelivery()
        .where(eq(schema.emailDeliveryTable.messageId, event.messageId))
        .limit(1);
      if (byMessageId !== undefined) {
        return yield* decodeDelivery(byMessageId);
      }
      if (event.deliveryId === undefined) {
        return undefined;
      }
      const [byDeliveryId] = yield* fromDelivery()
        .where(eq(schema.emailDeliveryTable.id, event.deliveryId))
        .limit(1);
      return byDeliveryId === undefined
        ? undefined
        : yield* decodeDelivery(byDeliveryId);
    });

  /**
   * Writes the suppression rows one bounce or complaint names.
   *
   * A hard bounce is an address fact, but the row belongs to the workspace
   * that observed it, so a listing or a removal stays inside that tenant. An
   * event we could not correlate has no workspace, so it becomes a platform
   * row, which is also what a bounce of account mail (verification, password
   * reset) produces.
   *
   * `providerEventId` is attached only when the event names one recipient:
   * the column is unique, and a multi-recipient event has no single row that
   * owns it.
   */
  const suppress = (args: {
    readonly event: Extract<
      LifecycleEvent,
      { type: "bounced" } | { type: "complained" }
    >;
    readonly organizationId: string | null;
    readonly reason: "hard_bounce" | "complaint";
  }) =>
    Effect.forEach(
      args.event.recipients,
      (email) =>
        suppressions
          .upsert({
            email,
            note: null,
            now: args.event.occurredAt,
            organizationId: args.organizationId,
            providerEventId:
              args.event.recipients.length === 1 ? args.event.eventId : null,
            reason: args.reason,
          })
          .pipe(
            Effect.tap(() => recordEmailSuppression(args.reason, "provider"))
          ),
      { concurrency: 1, discard: true }
    );

  const ingest = Effect.fn("EmailProviderFeedbackService.ingest")(function* (
    input: LifecycleEvent | Schema.Json
  ) {
    const event = yield* decodeLifecycleEvent(input);

    return yield* db
      .transaction(() =>
        Effect.gen(function* () {
          const delivery = yield* findDelivery(event);

          // The ledger comes first, whether or not the event correlates to a
          // delivery: an uncorrelated event has no delivery to attach to, and
          // recording it here is what stops a redelivered SNS message from
          // being counted twice. `delivery_id` is nullable for exactly this.
          const [insertedEvent] = yield* db
            .insert(schema.emailProviderEventTable)
            .values({
              providerEventId: event.eventId,
              deliveryId: delivery?.id ?? null,
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

          if (delivery === undefined) {
            // The delivery cannot be found, but a hard bounce still names an
            // address that does not exist. Suppressing it is the whole point of
            // the feedback loop, and doing it without a delivery row is what
            // closes the gap for mail outside the outbox (verification,
            // password reset, invitations). The row is platform-scoped because
            // there is no workspace to attribute it to.
            //
            if (event.type === "bounced") {
              if (event.bounceType !== "hard") {
                // A soft or undetermined bounce of unattributed mail is
                // observable only; there is no delivery to reschedule.
                yield* recordEmailProviderBounce(
                  event.bounceType,
                  false,
                  false
                );
                return { _tag: "UnknownDelivery" as const, suppressed: false };
              }
              yield* suppress({
                event,
                organizationId: null,
                reason: "hard_bounce",
              });
              yield* recordEmailProviderBounce(
                "hard",
                event.recipients.length > 0,
                false
              );
              yield* Effect.logWarning(
                "Provider feedback could not be correlated to a delivery; suppressed the reported recipients"
              ).pipe(
                Effect.annotateLogs({
                  eventType: event.type,
                  providerEventId: event.eventId,
                })
              );
              return {
                _tag: "UnknownDelivery" as const,
                suppressed: event.recipients.length > 0,
              };
            }
            // A complaint is deliberately not suppressed here: a complaint is
            // about one sender's mail, and without a delivery there is no
            // sender to scope the row to. Writing a platform row would silence
            // every workspace because one unknown sender's recipient pressed
            // "spam". It is still counted: the complaint rate is a property of
            // the sending account, not of the correlation.
            if (event.type === "complained") {
              yield* recordEmailProviderComplaint(false);
            }
            return { _tag: "UnknownDelivery" as const, suppressed: false };
          }

          /**
           * Records that the provider took the message, independently of the
           * lifecycle transition below.
           *
           * A transition only applies from the states `delivery-state.ts`
           * permits, and feedback routinely lands on a row that has already
           * left them: a `delivered` event for a delivery the worker deferred
           * after an uncertain submission has no legal target, and a `failed`
           * event that arrives after a `delivered` one does not either. The
           * acceptance is not conditional on that transition. The provider
           * having the message is a fact about the send, and the monthly volume
           * count reads that fact, so it is written whether or not the row
           * moves.
           *
           * Every type here except `failed` proves the provider took the
           * message; `failed` (SES `Reject`) proves the opposite — a message
           * the provider rejected instead of accepting — so it is the one
           * type that must not start this count. See the contract on the
           * variant in `schema.ts`. The stamp prefers the provider's own
           * acceptance moment, `event.acceptedAt` (SES `mail.timestamp`),
           * and falls back to the feedback event's time — whose only claim
           * is to be present.
           *
           * `coalesce` keeps the first acceptance: feedback reports a send that
           * already happened and never supersedes a timestamp a send recorded.
           */
          const recordProviderAcceptance = () =>
            db
              .update(schema.emailDeliveryTable)
              .set({
                acceptedAt: sql`coalesce(${schema.emailDeliveryTable.acceptedAt}, ${event.acceptedAt ?? event.occurredAt})`,
                updatedAt: sql`greatest(${schema.emailDeliveryTable.updatedAt}, ${event.occurredAt})`,
              })
              .where(
                and(
                  eq(schema.emailDeliveryTable.id, delivery.id),
                  isNull(schema.emailDeliveryTable.acceptedAt)
                )
              )
              .pipe(Effect.asVoid);

          if (event.type !== "failed") {
            yield* recordProviderAcceptance();
          }

          const transitionDelivery = (
            nextState: "delivered" | "deferred" | "bounced" | "failed",
            options?: { readonly nextAttemptAt?: Date }
          ) =>
            db
              .update(schema.emailDeliveryTable)
              .set({
                state: nextState,
                ...(nextState === "delivered" && {
                  deliveredAt: event.occurredAt,
                }),
                ...(options?.nextAttemptAt !== undefined && {
                  nextAttemptAt: options.nextAttemptAt,
                }),
                // Keep the persisted queue element id distinct after a provider
                // transition: `deferred` makes the row due again.
                transitionVersion: sql`${schema.emailDeliveryTable.transitionVersion} + 1`,
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

          /** Reschedules a soft or undetermined bounce, within the attempt budget. */
          const retryAfterSoftBounce = (bounceType: "soft" | "undetermined") =>
            Effect.gen(function* () {
              if (delivery.attemptCount >= maximumDeliveryAttempts) {
                const failed = yield* transitionDelivery("failed");
                yield* recordEmailDeliveryTransition("failed", failed ? 1 : 0);
                return failed;
              }
              const nextAttemptAt = DateTime.toDateUtc(
                DateTime.addDuration(
                  DateTime.makeUnsafe(event.occurredAt),
                  softBounceRetryDelay
                )
              );
              const deferred = yield* transitionDelivery("deferred", {
                nextAttemptAt,
              });
              yield* recordEmailDeliveryTransition(
                "deferred",
                deferred ? 1 : 0
              );
              yield* Effect.logWarning(
                "Email provider reported a transient bounce; delivery rescheduled"
              ).pipe(
                Effect.annotateLogs({
                  bounceType,
                  deliveryId: delivery.id,
                  providerEventId: event.eventId,
                })
              );
              return deferred;
            });

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
              // second send while the provider may still be attempting
              // delivery.
              yield* recordEmailDeliveryTransition("deferred");
              return {
                _tag: "Processed" as const,
                deliveryUpdated: false,
                suppressed: false,
              };
            }
            case "bounced": {
              if (event.bounceType !== "hard") {
                const deliveryUpdated = yield* retryAfterSoftBounce(
                  event.bounceType
                );
                yield* recordEmailProviderBounce(event.bounceType, false, true);
                return {
                  _tag: "Processed" as const,
                  deliveryUpdated,
                  suppressed: false,
                };
              }
              const deliveryUpdated = yield* transitionDelivery("bounced");
              yield* recordEmailDeliveryTransition(
                "bounced",
                deliveryUpdated ? 1 : 0
              );
              yield* suppress({
                event,
                organizationId: delivery.organizationId,
                reason: "hard_bounce",
              });
              yield* recordEmailProviderBounce(
                "hard",
                event.recipients.length > 0,
                true
              );
              yield* Effect.logWarning(
                "Email provider hard-bounce alert signal"
              ).pipe(
                Effect.annotateLogs({
                  deliveryId: delivery.id,
                  providerEventId: event.eventId,
                })
              );
              return {
                _tag: "Processed" as const,
                deliveryUpdated,
                suppressed: event.recipients.length > 0,
              };
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
              yield* suppress({
                event,
                organizationId: delivery.organizationId,
                reason: "complaint",
              });
              yield* recordEmailProviderComplaint(true);
              yield* Effect.logWarning(
                "Email provider complaint alert signal"
              ).pipe(
                Effect.annotateLogs({
                  deliveryId: delivery.id,
                  providerEventId: event.eventId,
                })
              );
              return {
                _tag: "Processed" as const,
                deliveryUpdated,
                suppressed: event.recipients.length > 0,
              };
            }
            default:
              return event satisfies never;
          }
        })
      )
      .pipe(
        Effect.mapError((cause) =>
          Schema.is(EmailProviderFeedbackInputError)(cause)
            ? cause
            : dataError(
                "ingest",
                Schema.is(EmailProviderFeedbackDataError)(cause)
                  ? cause.reason
                  : "database"
              )
        )
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
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(EmailSuppressionRepository.layer)
  );
}
