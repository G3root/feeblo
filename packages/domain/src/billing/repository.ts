import { Database, schema } from "@feeblo/db";
import { generateId } from "@feeblo/utils/id";
import type { WebhookProductCreatedPayload } from "@polar-sh/sdk/models/components/webhookproductcreatedpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
import { eq } from "drizzle-orm";
import {
  Context,
  Effect,
  Array as EffectArray,
  Layer,
  Option,
  Schema,
  SchemaTransformation,
} from "effect";

type SubscriptionPayload = WebhookSubscriptionCreatedPayload["data"];
type ProductPayload = WebhookProductCreatedPayload["data"];

type SubscriptionInsert = typeof schema.subscriptionTable.$inferInsert;
type ProductInsert = typeof schema.productTable.$inferInsert;

const DbSubscriptionStatus = Schema.Literals([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
]);

const SubscriptionStatusFromPolar = Schema.String.pipe(
  Schema.decodeTo(
    DbSubscriptionStatus,
    SchemaTransformation.transform({
      decode: (value) =>
        Schema.is(DbSubscriptionStatus)(value) ? value : "incomplete",
      encode: (value) => value,
    })
  )
);

const ProductRecurringIntervalFromPolar = Schema.NullOr(Schema.String).pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.Literals(["month", "year"])),
    SchemaTransformation.transform({
      decode: (value) => (value === "month" || value === "year" ? value : null),
      encode: (value) => value,
    })
  )
);

const ProductMetadataSchema = Schema.Struct({
  plan: Schema.Literals(["starter", "professional"]),
  variant: Schema.Literals(["monthly", "yearly"]),
});

const ProductMetadataFromPolar = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.NullOr(ProductMetadataSchema),
    SchemaTransformation.transform({
      decode: (value) => {
        try {
          const decoded = Schema.decodeUnknownSync(ProductMetadataSchema)(
            value
          );
          return decoded;
        } catch (_error) {
          return null;
        }
      },
      encode: (value) => value,
    })
  )
);

const decodeString = Schema.decodeUnknownSync(Schema.String);
const decodeSubscriptionStatus = Schema.decodeUnknownSync(
  SubscriptionStatusFromPolar
);
const decodeProductRecurringInterval = Schema.decodeUnknownSync(
  ProductRecurringIntervalFromPolar
);
const decodeProductMetadata = Schema.decodeUnknownSync(
  ProductMetadataFromPolar
);

const toSubscriptionValues = (
  payload: SubscriptionPayload
): SubscriptionInsert => ({
  id: generateId("subscription"),
  externalId: payload.id,
  organizationId: decodeString(payload.metadata.org),
  amount: payload.amount,
  cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
  currency: payload.currency,
  recurringInterval: payload.recurringInterval,
  recurringIntervalCount: payload.recurringIntervalCount,
  status: decodeSubscriptionStatus(payload.status),
  currentPeriodStart: payload.currentPeriodStart,
  currentPeriodEnd: payload.currentPeriodEnd,
  trialStart: payload.trialStart,
  trialEnd: payload.trialEnd,
  canceledAt: payload.canceledAt,
  startedAt: payload.startedAt,
  endsAt: payload.endsAt,
  endedAt: payload.endedAt,
  customerId: payload.customerId,
  productId: decodeString(payload.productId),
  discountId: payload.discountId,
  checkoutId: payload.checkoutId,
  seats: payload.seats,
});

const toProductValues = (payload: ProductPayload): ProductInsert => ({
  id: payload.id,
  name: payload.name,
  description: payload.description,
  trialInterval: payload.trialInterval,
  trialIntervalCount: payload.trialIntervalCount,
  recurringInterval: decodeProductRecurringInterval(payload.recurringInterval),
  recurringIntervalCount: payload.recurringIntervalCount,
  isRecurring: payload.isRecurring,
  isArchived: payload.isArchived,
  externalOrganizationId: payload.organizationId,
  visibility: payload.visibility,
  createdAt: payload.createdAt,
  updatedAt: payload.modifiedAt ?? new Date(),
  metadata: decodeProductMetadata(payload.metadata),
  prices: payload.prices,
});

const makeBillingRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    createSubscription: (payload: SubscriptionPayload) =>
      db.makeQuery((execute, input: SubscriptionPayload) =>
        execute((client) =>
          client
            .insert(schema.subscriptionTable)
            .values(toSubscriptionValues(input))
        )
      )(payload),
    upsertSubscription: (payload: SubscriptionPayload) =>
      Effect.gen(function* () {
        const existingSubscription = yield* db
          .makeQuery((execute, input: SubscriptionPayload) =>
            execute((client) =>
              client
                .select({ id: schema.subscriptionTable.id })
                .from(schema.subscriptionTable)
                .where(eq(schema.subscriptionTable.externalId, input.id))
                .limit(1)
            )
          )(payload)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingSubscription)) {
          const { id: _id, ...values } = toSubscriptionValues(payload);

          yield* db.makeQuery((execute, input: SubscriptionPayload) =>
            execute((client) =>
              client
                .update(schema.subscriptionTable)
                .set({
                  ...values,
                  updatedAt: new Date(),
                })
                .where(eq(schema.subscriptionTable.externalId, input.id))
            )
          )(payload);
          return;
        }

        yield* db.makeQuery((execute, input: SubscriptionPayload) =>
          execute((client) =>
            client
              .insert(schema.subscriptionTable)
              .values(toSubscriptionValues(input))
          )
        )(payload);
      }),
    createProduct: (payload: ProductPayload) =>
      db.makeQuery((execute, input: ProductPayload) =>
        execute((client) =>
          client.insert(schema.productTable).values(toProductValues(input))
        )
      )(payload),
    upsertProduct: (payload: ProductPayload) =>
      Effect.gen(function* () {
        const existingProduct = yield* db
          .makeQuery((execute, input: ProductPayload) =>
            execute((client) =>
              client
                .select({ id: schema.productTable.id })
                .from(schema.productTable)
                .where(eq(schema.productTable.id, input.id))
                .limit(1)
            )
          )(payload)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingProduct)) {
          yield* db.makeQuery((execute, input: ProductPayload) =>
            execute((client) =>
              client
                .update(schema.productTable)
                .set({
                  ...toProductValues(input),
                  updatedAt: input.modifiedAt ?? new Date(),
                })
                .where(eq(schema.productTable.id, input.id))
            )
          )(payload);
          return;
        }

        yield* db.makeQuery((execute, input: ProductPayload) =>
          execute((client) =>
            client.insert(schema.productTable).values(toProductValues(input))
          )
        )(payload);
      }),
    findSubscriptionByOrganizationId: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      db
        .makeQuery((execute, input: { organizationId: string }) =>
          execute((client) =>
            client
              .select({
                id: schema.subscriptionTable.id,
                customerId: schema.subscriptionTable.customerId,
                organizationId: schema.subscriptionTable.organizationId,
              })
              .from(schema.subscriptionTable)
              .where(
                eq(
                  schema.subscriptionTable.organizationId,
                  input.organizationId
                )
              )
          )
        )({ organizationId })
        .pipe(Effect.map(EffectArray.get(0))),
  };
});

export class BillingRepository extends Context.Service<BillingRepository>()(
  "BillingRepository",
  {
    make: makeBillingRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
