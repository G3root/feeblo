import { currentDb, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { EmailDeliveryState, EmailOutboxState } from "./schema";

export class EmailOutboxInspectionError extends Schema.TaggedErrorClass<EmailOutboxInspectionError>()(
  "EmailOutboxInspectionError",
  { reason: Schema.String }
) {}

const emptyIntentStates = () => ({
  pending: 0,
  materialized: 0,
  paused_by_plan: 0,
  expired: 0,
});

const emptyDeliveryStates = () => ({
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
});

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
      .select({ state: schema.emailOutboxTable.state })
      .from(schema.emailOutboxTable)
      .where(eq(schema.emailOutboxTable.organizationId, organizationId));
    const deliveries = yield* db
      .select({
        createdAt: schema.emailDeliveryTable.createdAt,
        state: schema.emailDeliveryTable.state,
      })
      .from(schema.emailDeliveryTable)
      .innerJoin(
        schema.emailOutboxTable,
        eq(schema.emailOutboxTable.id, schema.emailDeliveryTable.outboxId)
      )
      .where(eq(schema.emailOutboxTable.organizationId, organizationId));

    const intentStates = emptyIntentStates();
    for (const row of intents) {
      const state = yield* Schema.decodeUnknownEffect(EmailOutboxState)(row.state).pipe(
        Effect.mapError(() => new EmailOutboxInspectionError({
          reason: "Stored email outbox state is invalid",
        }))
      );
      intentStates[state] += 1;
    }

    const deliveryStates = emptyDeliveryStates();
    let oldestQueuedAt: Date | undefined;
    for (const row of deliveries) {
      const state = yield* Schema.decodeUnknownEffect(EmailDeliveryState)(row.state).pipe(
        Effect.mapError(() => new EmailOutboxInspectionError({
          reason: "Stored email delivery state is invalid",
        }))
      );
      deliveryStates[state] += 1;
      if (
        (state === "queued" || state === "deferred" || state === "sending") &&
        (oldestQueuedAt === undefined || row.createdAt < oldestQueuedAt)
      ) {
        oldestQueuedAt = row.createdAt;
      }
    }

    return {
      deliveryStates,
      intentStates,
      oldestQueuedAgeMs: oldestQueuedAt === undefined
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
