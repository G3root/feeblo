import { currentDb, schema } from "@feeblo/db";
import { entitledSubscriptionCondition } from "@feeblo/db/schema/billing";
import { SubscriptionId } from "@feeblo/id";
import type { WebhookProductCreatedPayload } from "@polar-sh/sdk/models/components/webhookproductcreatedpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PAID_PLAN_KEYS } from "../plan-entitlements";

type SubscriptionPayload = WebhookSubscriptionCreatedPayload["data"];
type ProductPayload = WebhookProductCreatedPayload["data"];

type SubscriptionInsert = typeof schema.subscriptionTable.$inferInsert;
type ProductInsert = typeof schema.productTable.$inferInsert;

interface TFindSubscriptionByOrganizationId {
  organizationId: string;
}

interface TFindCheckoutProduct {
  productId: string;
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
      decode: (value) =>
        Option.getOrNull(
          Schema.decodeUnknownOption(ProductMetadataSchema)(value)
        ),
      encode: (value) => value,
    })
  )
);

/**
 * The `org` key a checkout stamps into Polar metadata. Polar types metadata
 * values as `string | number | boolean` and the key is absent on
 * subscriptions Feeblo did not create, so this is an optional read, not a
 * string decode: a value that is not a string means "not our subscription",
 * not "the SDK sent garbage".
 */
const SubscriptionMetadataSchema = Schema.Struct({
  org: Schema.String,
});

const SubscriptionOrganizationIdFromPolar = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Option(Schema.String),
    SchemaTransformation.transform({
      decode: (value) =>
        Option.map(
          Schema.decodeUnknownOption(SubscriptionMetadataSchema)(value),
          (metadata) => metadata.org
        ),
      encode: (value) => value,
    })
  )
);

// The product id is a genuinely required string on every Polar payload, so a
// decode failure there means the SDK sent garbage and dying the fiber (defect)
// is deliberate over silently coercing it. The workspace key is different and
// is decoded as an Option above, because a subscription without it is merely
// one Feeblo does not own.
// eslint-disable-next-line effecttsgo/schema-sync -- see block comment above
const decodeString = Schema.decodeUnknownSync(Schema.String);
// Never fails: SubscriptionOrganizationIdFromPolar is total and returns an
// Option. Reported only because the rule cannot see that.
// eslint-disable-next-line effecttsgo/schema-sync -- see block comment above
const decodeSubscriptionOrganizationId = Schema.decodeUnknownSync(
  SubscriptionOrganizationIdFromPolar
);
// eslint-disable-next-line effecttsgo/schema-sync -- see block comment above
const decodeSubscriptionStatus = Schema.decodeUnknownSync(
  SubscriptionStatusFromPolar
);
// eslint-disable-next-line effecttsgo/schema-sync -- see block comment above
const decodeProductRecurringInterval = Schema.decodeUnknownSync(
  ProductRecurringIntervalFromPolar
);
// Never throws: the ProductMetadataFromPolar transformation is total
// (Option.getOrNull). Reported only because the rule cannot see that.
// eslint-disable-next-line effecttsgo/schema-sync -- see block comment above
const decodeProductMetadata = Schema.decodeUnknownSync(
  ProductMetadataFromPolar
);

const toSubscriptionValues = (
  payload: SubscriptionPayload,
  id: string,
  organizationId: string,
  eventTimestamp: Date
): SubscriptionInsert => ({
  id,
  externalId: payload.id,
  organizationId,
  lastEventAt: eventTimestamp,
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

const toProductValues = (
  payload: ProductPayload,
  now: Date
): ProductInsert => ({
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
  updatedAt: payload.modifiedAt ?? now,
  metadata: decodeProductMetadata(payload.metadata),
  prices: payload.prices,
});

const makeBillingRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    /**
     * Applies one Polar subscription event. Two events are deliberately not
     * errors: a subscription whose metadata carries no string `org` (Polar
     * dashboard, import, or edited metadata) belongs to no workspace here, and
     * one whose workspace row is already gone arrives after a deletion that
     * has already queued its revocation. Both are logged and acknowledged so
     * Polar stops retrying an event this deployment can never apply.
     */
    upsertSubscription: (payload: SubscriptionPayload, eventTimestamp: Date) =>
      Effect.gen(function* () {
        const organizationId = decodeSubscriptionOrganizationId(
          payload.metadata
        );
        if (Option.isNone(organizationId)) {
          yield* Effect.logWarning(
            "Ignoring a Polar subscription that carries no workspace id",
            {
              externalSubscriptionId: payload.id,
              status: payload.status,
            }
          );
          return;
        }

        const organization = yield* db
          .select({ id: schema.organizationTable.id })
          .from(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId.value))
          .limit(1);
        if (organization.length === 0) {
          yield* Effect.logWarning(
            "Ignoring a Polar subscription for a deleted workspace",
            {
              externalSubscriptionId: payload.id,
              organizationId: organizationId.value,
            }
          );
          return;
        }

        const id = yield* SubscriptionId.generate;
        const now = yield* DateTime.nowAsDate;
        const values = toSubscriptionValues(
          payload,
          id,
          organizationId.value,
          eventTimestamp
        );
        const { id: _id, ...updateValues } = values;
        yield* db
          .insert(schema.subscriptionTable)
          .values(values)
          .onConflictDoUpdate({
            target: schema.subscriptionTable.externalId,
            set: {
              ...updateValues,
              updatedAt: now,
            },
            // Polar retries failed deliveries, so a retried older event can
            // arrive after a newer one. Keep the newer state; only rows synced
            // before `lastEventAt` existed (null) accept any event.
            setWhere: sql`${schema.subscriptionTable.lastEventAt} is null or ${schema.subscriptionTable.lastEventAt} <= ${eventTimestamp}`,
          });
      }),
    upsertProduct: (payload: ProductPayload) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .insert(schema.productTable)
          .values(toProductValues(payload, now))
          .onConflictDoUpdate({
            target: schema.productTable.id,
            set: {
              ...toProductValues(payload, now),
              updatedAt: payload.modifiedAt ?? now,
            },
          })
          .pipe(Effect.asVoid);
      }),
    findCheckoutProduct: ({ productId }: TFindCheckoutProduct) =>
      db
        .select({
          id: schema.productTable.id,
        })
        .from(schema.productTable)
        .where(
          and(
            eq(schema.productTable.id, productId),
            eq(schema.productTable.isArchived, false),
            eq(schema.productTable.isRecurring, true),
            inArray(schema.productTable.recurringInterval, ["month", "year"]),
            inArray(
              sql`${schema.productTable.metadata}->>'plan'`,
              PAID_PLAN_KEYS
            ),
            or(
              and(
                eq(schema.productTable.recurringInterval, "month"),
                sql`${schema.productTable.metadata}->>'variant' = 'monthly'`
              ),
              and(
                eq(schema.productTable.recurringInterval, "year"),
                sql`${schema.productTable.metadata}->>'variant' = 'yearly'`
              )
            )
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),
    findCurrentSubscriptionByOrganizationId: ({
      organizationId,
    }: TFindSubscriptionByOrganizationId) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .select({
            id: schema.subscriptionTable.id,
            customerId: schema.subscriptionTable.customerId,
            organizationId: schema.subscriptionTable.organizationId,
          })
          .from(schema.subscriptionTable)
          .where(
            and(
              eq(schema.subscriptionTable.organizationId, organizationId),
              entitledSubscriptionCondition(now)
            )
          )
          .orderBy(
            desc(schema.subscriptionTable.currentPeriodEnd),
            desc(schema.subscriptionTable.createdAt)
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));
      }),
    findSubscriptionByOrganizationId: ({
      organizationId,
    }: TFindSubscriptionByOrganizationId) =>
      db
        .select({
          id: schema.subscriptionTable.id,
          externalId: schema.subscriptionTable.externalId,
          customerId: schema.subscriptionTable.customerId,
          organizationId: schema.subscriptionTable.organizationId,
        })
        .from(schema.subscriptionTable)
        .where(eq(schema.subscriptionTable.organizationId, organizationId))
        .orderBy(
          sql`case when ${schema.subscriptionTable.status} in ('active', 'trialing', 'past_due') then 0 else 1 end`,
          desc(schema.subscriptionTable.currentPeriodEnd),
          desc(schema.subscriptionTable.createdAt)
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),

    /** Every subscription a workspace holds, while the rows still exist. */
    findSubscriptionsByOrganizationId: ({
      organizationId,
    }: TFindSubscriptionByOrganizationId) =>
      db
        .select({ externalId: schema.subscriptionTable.externalId })
        .from(schema.subscriptionTable)
        .where(eq(schema.subscriptionTable.organizationId, organizationId)),

    /**
     * Enqueues one revocation row per subscription the workspace holds,
     * idempotently. Runs inside the deletion transaction for account deletion
     * and immediately before the delete in the workspace hook, so a rolled-back
     * delete leaves no work the retry loop would act on: the loop only revokes
     * rows whose organization no longer exists.
     */
    enqueueSubscriptionRevocationsForOrganization: ({
      organizationId,
    }: TFindSubscriptionByOrganizationId) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const subscriptions = yield* db
          .select({ externalId: schema.subscriptionTable.externalId })
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.organizationId, organizationId));
        if (subscriptions.length === 0) {
          return;
        }
        yield* db
          .insert(schema.subscriptionRevocationTable)
          .values(
            subscriptions.map((subscription) => ({
              externalSubscriptionId: subscription.externalId,
              organizationId,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoNothing();
      }),

    /**
     * Revocations ready to run: not revoked yet, and whose workspace is gone.
     * The organization check is the safety gate for a deletion that failed
     * after enqueueing.
     */
    findPendingSubscriptionRevocations: ({
      organizationId,
      limit,
    }: {
      organizationId?: string;
      limit: number;
    }) => {
      const conditions = [
        isNull(schema.subscriptionRevocationTable.revokedAt),
        notExists(
          db
            .select({ id: schema.organizationTable.id })
            .from(schema.organizationTable)
            .where(
              eq(
                schema.organizationTable.id,
                schema.subscriptionRevocationTable.organizationId
              )
            )
        ),
      ];
      if (organizationId !== undefined) {
        conditions.push(
          eq(schema.subscriptionRevocationTable.organizationId, organizationId)
        );
      }
      return db
        .select({
          externalSubscriptionId:
            schema.subscriptionRevocationTable.externalSubscriptionId,
          organizationId: schema.subscriptionRevocationTable.organizationId,
          attempts: schema.subscriptionRevocationTable.attempts,
        })
        .from(schema.subscriptionRevocationTable)
        .where(and(...conditions))
        .orderBy(asc(schema.subscriptionRevocationTable.updatedAt))
        .limit(limit);
    },

    markSubscriptionRevocationSucceeded: ({
      externalSubscriptionId,
    }: {
      externalSubscriptionId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.subscriptionRevocationTable)
          .set({ revokedAt: now, lastError: null, updatedAt: now })
          .where(
            and(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                externalSubscriptionId
              ),
              // Setting both marks on `revoked_at is null` keeps a late
              // failure from a concurrent pass from re-opening a success.
              isNull(schema.subscriptionRevocationTable.revokedAt)
            )
          );
      }),

    markSubscriptionRevocationFailed: ({
      externalSubscriptionId,
      message,
    }: {
      externalSubscriptionId: string;
      message: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.subscriptionRevocationTable)
          .set({
            attempts: sql`${schema.subscriptionRevocationTable.attempts} + 1`,
            lastError: message,
            updatedAt: now,
          })
          .where(
            and(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                externalSubscriptionId
              ),
              isNull(schema.subscriptionRevocationTable.revokedAt)
            )
          );
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
