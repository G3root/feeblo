import { schema, currentDb } from "@feeblo/db";
import { SubscriptionId } from "@feeblo/id";
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

interface TFindSubscriptionByOrganizationId {
  organizationId: string;
}

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
  payload: SubscriptionPayload,
  id: string
): SubscriptionInsert => ({
  id,
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
  return {
    createSubscription: (payload: SubscriptionPayload) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const id = yield* SubscriptionId.generate;
        yield* db
          .insert(schema.subscriptionTable)
          .values(toSubscriptionValues(payload, id));
      }),
    upsertSubscription: (payload: SubscriptionPayload) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const existingSubscription = yield* db
          .select({ id: schema.subscriptionTable.id })
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, payload.id))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingSubscription)) {
          const { id } = existingSubscription.value;
          const { id: _id, ...values } = toSubscriptionValues(payload, id);

          yield* db
            .update(schema.subscriptionTable)
            .set({
              ...values,
              updatedAt: new Date(),
            })
            .where(eq(schema.subscriptionTable.externalId, payload.id));
          return;
        }

        const id = yield* SubscriptionId.generate;
        yield* db
          .insert(schema.subscriptionTable)
          .values(toSubscriptionValues(payload, id));
      }),
    createProduct: (payload: ProductPayload) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db.insert(schema.productTable).values(toProductValues(payload));
      }),
    upsertProduct: (payload: ProductPayload) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const existingProduct = yield* db
          .select({ id: schema.productTable.id })
          .from(schema.productTable)
          .where(eq(schema.productTable.id, payload.id))
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

        if (Option.isSome(existingProduct)) {
          yield* db
            .update(schema.productTable)
            .set({
              ...toProductValues(payload),
              updatedAt: payload.modifiedAt ?? new Date(),
            })
            .where(eq(schema.productTable.id, payload.id));
          return;
        }

        yield* db.insert(schema.productTable).values(toProductValues(payload));
      }),
    findSubscriptionByOrganizationId: ({
      organizationId,
    }: TFindSubscriptionByOrganizationId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.subscriptionTable.id,
            customerId: schema.subscriptionTable.customerId,
            organizationId: schema.subscriptionTable.organizationId,
          })
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.organizationId, organizationId))
          .pipe(Effect.map(EffectArray.get(0)));
      }),
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
