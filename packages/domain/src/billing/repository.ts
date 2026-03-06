import { DB } from "@feeblo/db";
import {
  product as productTable,
  subscription as subscriptionTable,
} from "@feeblo/db/schema/auth";
import { generateId } from "@feeblo/utils/id";
import type { WebhookProductCreatedPayload } from "@polar-sh/sdk/models/components/webhookproductcreatedpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
import { eq } from "drizzle-orm";
import { Effect, Array as EffectArray, Option, Schema } from "effect";

type SubscriptionPayload = WebhookSubscriptionCreatedPayload["data"];
type ProductPayload = WebhookProductCreatedPayload["data"];

type SubscriptionInsert = typeof subscriptionTable.$inferInsert;
type ProductInsert = typeof productTable.$inferInsert;

const DbSubscriptionStatus = Schema.Literal(
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid"
);

const SubscriptionStatusFromPolar = Schema.transform(
  Schema.String,
  DbSubscriptionStatus,
  {
    strict: false,
    decode: (value) =>
      Schema.is(DbSubscriptionStatus)(value) ? value : "incomplete",
    encode: (value) => value,
  }
);

const ProductRecurringIntervalFromPolar = Schema.transform(
  Schema.NullOr(Schema.String),
  Schema.NullOr(Schema.Literal("month", "year")),
  {
    strict: false,
    decode: (value) => (value === "month" || value === "year" ? value : null),
    encode: (value) => value,
  }
);

const ProductMetadataSchema = Schema.Struct({
  plan: Schema.Literal("starter", "professional"),
  variant: Schema.Literal("monthly", "yearly"),
});

const ProductMetadataFromPolar = Schema.transform(
  Schema.Unknown,
  Schema.NullOr(ProductMetadataSchema),
  {
    strict: false,
    decode: (value) => {
      const decoded = Schema.decodeUnknownEither(ProductMetadataSchema)(value);
      return decoded._tag === "Right" ? decoded.right : null;
    },
    encode: (value) => value,
  }
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

export class BillingRepository extends Effect.Service<BillingRepository>()(
  "BillingRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        createSubscription: (payload: SubscriptionPayload) =>
          db.insert(subscriptionTable).values(toSubscriptionValues(payload)),
        updateSubscription: (payload: SubscriptionPayload) =>
          Effect.gen(function* () {
            const existingSubscription = yield* db
              .select({ id: subscriptionTable.id })
              .from(subscriptionTable)
              .where(eq(subscriptionTable.externalId, payload.id))
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existingSubscription)) {
              const { id: _id, ...values } = toSubscriptionValues(payload);

              yield* db
                .update(subscriptionTable)
                .set({
                  ...values,
                  updatedAt: new Date(),
                })
                .where(eq(subscriptionTable.externalId, payload.id));
              return;
            }

            yield* db
              .insert(subscriptionTable)
              .values(toSubscriptionValues(payload));
          }),
        createProduct: (payload: ProductPayload) =>
          db.insert(productTable).values(toProductValues(payload)),
        updateProduct: (payload: ProductPayload) =>
          Effect.gen(function* () {
            const existingProduct = yield* db
              .select({ id: productTable.id })
              .from(productTable)
              .where(eq(productTable.id, payload.id))
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existingProduct)) {
              yield* db
                .update(productTable)
                .set({
                  ...toProductValues(payload),
                  updatedAt: payload.modifiedAt ?? new Date(),
                })
                .where(eq(productTable.id, payload.id));
              return;
            }

            yield* db.insert(productTable).values(toProductValues(payload));
          }),
      };
    }),
  }
) {}
