import { currentDb, schema } from "@feeblo/db";
import type {
  TEmailDeliveryState,
  TEmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import {
  EmailDeliveryState,
  EmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import { count, eq, min } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

export class EmailOutboxInspectionError extends Schema.TaggedError<EmailOutboxInspectionError>()(
  "EmailOutboxInspectionError",
  { reason: Schema.String }
) {}

const emptyIntentStates = () =>
  ({
    pending: 0,
    materialized: 0,
    paused_by_plan: 0,
    failed: 0,
    expired: 0,
  }) satisfies Record<TEmailOutboxState, number>;

const emptyDeliveryStates = () =>
  ({
    queued: 0,
    sending: 0,
    accepted: 0,
    delivered: 0,
    deferred: 0,
    bounced: 0,
    failed: 0,
    suppressed: 0,
    paused_by_plan: 0,
    expired: 0,
  }) satisfies Record<TEmailDeliveryState, number>;

const makeEmailOutboxOperations = Effect.gen(function* () {
  const db = yield* currentDb;

  const inspect = Effect.fn("EmailOutboxOperations.inspect")(function* ({
    now,
    organizationId,
  }: {
    readonly now: Date;
    readonly organizationId: string;
  }) {
    const intents = yield* db
      .select({
        state: schema.emailOutboxTable.state,
        total: count(),
      })
      .from(schema.emailOutboxTable)
      .where(eq(schema.emailOutboxTable.organizationId, organizationId))
      .groupBy(schema.emailOutboxTable.state);
    const deliveries = yield* db
      .select({
        oldestCreatedAt: min(schema.emailDeliveryTable.createdAt),
        state: schema.emailDeliveryTable.state,
        total: count(),
      })
      .from(schema.emailDeliveryTable)
      .innerJoin(
        schema.emailOutboxTable,
        eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId)
      )
      .where(eq(schema.emailOutboxTable.organizationId, organizationId))
      .groupBy(schema.emailDeliveryTable.state);

    const intentStates = emptyIntentStates();
    for (const row of intents) {
      const state = yield* Schema.decodeUnknownEffect(EmailOutboxState)(
        row.state
      ).pipe(
        Effect.mapError(
          () =>
            new EmailOutboxInspectionError({
              reason: "Stored email outbox state is invalid",
            })
        )
      );
      intentStates[state] += row.total;
    }

    const deliveryStates = emptyDeliveryStates();
    let oldestQueuedAt: Date | undefined;
    for (const row of deliveries) {
      const state = yield* Schema.decodeUnknownEffect(EmailDeliveryState)(
        row.state
      ).pipe(
        Effect.mapError(
          () =>
            new EmailOutboxInspectionError({
              reason: "Stored email delivery state is invalid",
            })
        )
      );
      deliveryStates[state] += row.total;
      if (
        (state === "queued" || state === "deferred" || state === "sending") &&
        row.oldestCreatedAt !== null
      ) {
        const oldestCreatedAt = yield* Schema.decodeUnknownEffect(
          PersistedDate
        )(row.oldestCreatedAt).pipe(
          Effect.mapError(
            () =>
              new EmailOutboxInspectionError({
                reason: "Stored email delivery timestamp is invalid",
              })
          )
        );
        if (oldestQueuedAt === undefined || oldestCreatedAt < oldestQueuedAt) {
          oldestQueuedAt = oldestCreatedAt;
        }
      }
    }

    return {
      deliveryStates,
      intentStates,
      oldestQueuedAgeMs:
        oldestQueuedAt === undefined
          ? null
          : Math.max(0, now.getTime() - oldestQueuedAt.getTime()),
      organizationId,
    };
  });

  return { inspect };
});

/** Read-only operational inspection of the database-backed email pipeline. */
export class EmailOutboxOperations extends Context.Service<EmailOutboxOperations>()(
  "EmailOutboxOperations",
  { make: makeEmailOutboxOperations }
) {
  static readonly layer = Layer.effect(this, this.make);
}
