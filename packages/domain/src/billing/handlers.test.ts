import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CurrentSession, type Session } from "../session-middleware";
import { BillingRpcHandlersEffect } from "./handlers";
import { BillingRepository } from "./repository";
import { PolarService } from "./service";
import {
  makeSubscriptionPayload,
  type SubscriptionPayload,
} from "./test-support";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

/**
 * What the fake Polar service answers for the checkout-confirmation read.
 * Effect-free on purpose, like the revocation fake: a test sets it before the
 * single call under test.
 */
let confirmedSubscription: Option.Option<{
  subscription: SubscriptionPayload;
  eventTimestamp: Date;
}> = Option.none();

describe("BillingRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    userId: string;
  };
  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role,
          },
        ]
      : [],
  });
  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = yield* DateTime.nowAsDate;
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      return { membershipId, organizationId, userId } satisfies Fixture;
    });
  const PolarServiceTest = Layer.succeed(PolarService, {
    client: undefined,
    coreClient: undefined,
    target: "sandbox",
    webhookSecret: Option.none(),
    getOrganizationSettings: () => Effect.succeedNone,
    createCheckout: () =>
      Effect.succeed({ url: "https://sandbox.polar.sh/checkout" }),
    createPortal: ({ customerId }: { customerId: string }) =>
      Effect.succeed({ url: `https://sandbox.polar.sh/portal/${customerId}` }),
    revokeSubscription: () => Effect.void,
    findSubscriptionForCheckout: () => Effect.sync(() => confirmedSubscription),
  });
  const TestLayer = Layer.mergeAll(
    BillingRepository.layer.pipe(Layer.provide(PolarServiceTest)),
    // Exposed as well as provided: the revocation pass and the handlers read
    // the service directly.
    PolarServiceTest
  ).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

  layer(TestLayer)("handlers", (it) => {
    it.effect("rejects members without billing privileges", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .CreateBillingCheckout({
              organizationId: fixture.organizationId,
              productId: "product",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "manager")
              )
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );
    it.effect("rejects users without an organization membership", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const error = yield* Effect.flip(
          handlers
            .CreateBillingPortal({ organizationId: fixture.organizationId })
            .pipe(
              Effect.provideService(CurrentSession, makeSession(fixture, null))
            )
        );
        expect(error._tag).toBe("PolicyDenied");
      })
    );

    it.effect("creates checkout for a current recurring paid product", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;

        yield* db.insert(schema.productTable).values({
          id: "prod_checkout_current",
          name: "Starter monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });

        const result = yield* handlers
          .CreateBillingCheckout({
            organizationId: fixture.organizationId,
            productId: "prod_checkout_current",
          })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "owner"))
          );

        expect(result.url).toBe("https://sandbox.polar.sh/checkout");
      })
    );

    it.effect("rejects checkout for products that are not sellable plans", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;

        yield* db.insert(schema.productTable).values({
          id: "prod_checkout_archived",
          name: "Retired plan",
          isRecurring: true,
          isArchived: true,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });

        const error = yield* Effect.flip(
          handlers
            .CreateBillingCheckout({
              organizationId: fixture.organizationId,
              productId: "prod_checkout_archived",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "owner")
              )
            )
        );

        expect(error._tag).toBe("BadRequestError");
        expect(error.message).toBe("This billing product is unavailable");
      })
    );

    it.effect(
      "rejects a second checkout while a paid subscription exists",
      () =>
        Effect.gen(function* () {
          const handlers = yield* BillingRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;

          yield* db.insert(schema.productTable).values({
            id: "prod_checkout_duplicate",
            name: "Professional monthly",
            isRecurring: true,
            isArchived: false,
            externalOrganizationId: "polar_org",
            visibility: "PUBLIC",
            recurringInterval: "month",
            metadata: { plan: "professional", variant: "monthly" },
          });
          yield* db.insert(schema.subscriptionTable).values({
            id: "sub_checkout_duplicate",
            externalId: "sub_ext_checkout_duplicate",
            organizationId: fixture.organizationId,
            amount: 4900,
            cancelAtPeriodEnd: false,
            currency: "usd",
            recurringInterval: "month",
            recurringIntervalCount: 1,
            status: "trialing",
            currentPeriodStart: yield* DateTime.nowAsDate,
            currentPeriodEnd: dateAt(
              (yield* Clock.currentTimeMillis) + 86_400_000
            ),
            customerId: "cus_checkout_duplicate",
            productId: "prod_checkout_duplicate",
          });

          const error = yield* Effect.flip(
            handlers
              .CreateBillingCheckout({
                organizationId: fixture.organizationId,
                productId: "prod_checkout_duplicate",
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "owner")
                )
              )
          );

          expect(error._tag).toBe("BadRequestError");
          expect(error.message).toBe(
            "Manage the existing subscription in the billing portal"
          );
        })
    );

    it.effect("opens the portal for the newest relevant subscription", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;
        const now = yield* Clock.currentTimeMillis;

        yield* db.insert(schema.productTable).values({
          id: "prod_portal",
          name: "Starter monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });
        yield* db.insert(schema.subscriptionTable).values([
          {
            id: "sub_portal_old",
            externalId: "sub_ext_portal_old",
            organizationId: fixture.organizationId,
            amount: 2900,
            cancelAtPeriodEnd: false,
            currency: "usd",
            recurringInterval: "month",
            recurringIntervalCount: 1,
            status: "canceled",
            currentPeriodStart: dateAt(now - 60 * 86_400_000),
            currentPeriodEnd: dateAt(now - 30 * 86_400_000),
            customerId: "cus_old",
            productId: "prod_portal",
            createdAt: dateAt(now - 60 * 86_400_000),
          },
          {
            id: "sub_portal_current",
            externalId: "sub_ext_portal_current",
            organizationId: fixture.organizationId,
            amount: 2900,
            cancelAtPeriodEnd: false,
            currency: "usd",
            recurringInterval: "month",
            recurringIntervalCount: 1,
            status: "active",
            currentPeriodStart: dateAt(now),
            currentPeriodEnd: dateAt(now + 30 * 86_400_000),
            customerId: "cus_current",
            productId: "prod_portal",
            createdAt: dateAt(now),
          },
        ]);

        const result = yield* handlers
          .CreateBillingPortal({ organizationId: fixture.organizationId })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "owner"))
          );

        expect(result.url).toBe("https://sandbox.polar.sh/portal/cus_current");
      })
    );

    it.effect("applies the subscription a completed checkout confirms", () =>
      Effect.gen(function* () {
        const handlers = yield* BillingRpcHandlersEffect;
        const fixture = yield* makeFixture();
        const db = yield* currentDb;

        yield* db.insert(schema.productTable).values({
          id: "prod_checkout_confirm",
          name: "Starter monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          metadata: { plan: "starter", variant: "monthly" },
        });

        confirmedSubscription = Option.some({
          subscription: makeSubscriptionPayload({
            externalSubscriptionId: "sub_checkout_confirmed",
            organizationId: fixture.organizationId,
            productId: "prod_checkout_confirm",
          }),
          eventTimestamp: dateAt("2026-01-02T00:00:00.000Z"),
        });

        yield* handlers
          .ConfirmBillingCheckout({
            organizationId: fixture.organizationId,
            checkoutId: "checkout_confirmed",
          })
          .pipe(
            Effect.provideService(CurrentSession, makeSession(fixture, "owner"))
          );

        const [row] = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(
            eq(schema.subscriptionTable.externalId, "sub_checkout_confirmed")
          );

        expect(row?.organizationId).toBe(fixture.organizationId);
        expect(row?.status).toBe("active");
        expect(row?.lastEventAt?.toISOString()).toBe(
          "2026-01-02T00:00:00.000Z"
        );
      })
    );

    it.effect(
      "leaves the subscription alone when a checkout has none yet",
      () =>
        Effect.gen(function* () {
          const handlers = yield* BillingRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const db = yield* currentDb;

          confirmedSubscription = Option.none();

          yield* handlers
            .ConfirmBillingCheckout({
              organizationId: fixture.organizationId,
              checkoutId: "checkout_pending",
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "owner")
              )
            );

          const rows = yield* db
            .select({ id: schema.subscriptionTable.id })
            .from(schema.subscriptionTable)
            .where(
              eq(
                schema.subscriptionTable.organizationId,
                fixture.organizationId
              )
            );
          expect(rows).toHaveLength(0);
        })
    );
  });
});
