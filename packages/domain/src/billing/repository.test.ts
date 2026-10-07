import assert from "node:assert";

import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { Polar } from "@polar-sh/sdk";
import { subscriptionFromJSON } from "@polar-sh/sdk/models/components/subscription";
import { eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { FailedToRevokeSubscriptionError } from "./errors";
import { BillingRepository } from "./repository";
import { revokePendingSubscriptionRevocations } from "./revocation";
import { PolarService } from "./service";

const instant = (value: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(value));

/**
 * Builds a Polar subscription payload through the SDK's own codec, so a test
 * fixture that drifts from the SDK contract fails here instead of silently
 * escaping the repository's expectations.
 */
const makeSubscriptionPayload = ({
  externalSubscriptionId,
  organizationId,
  status = "active",
  metadata,
  productId,
}: {
  externalSubscriptionId: string;
  organizationId: string;
  status?: string;
  metadata?: unknown;
  productId: string;
}) => {
  const result = subscriptionFromJSON(
    JSON.stringify({
      id: externalSubscriptionId,
      created_at: "2026-01-01T00:00:00.000Z",
      modified_at: null,
      amount: 2900,
      currency: "usd",
      recurring_interval: "month",
      recurring_interval_count: 1,
      status,
      current_period_start: "2026-01-01T00:00:00.000Z",
      current_period_end: "2026-02-01T00:00:00.000Z",
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      started_at: null,
      ends_at: null,
      ended_at: null,
      customer_id: `cus_${externalSubscriptionId}`,
      product_id: productId,
      discount_id: null,
      checkout_id: null,
      seats: null,
      customer_cancellation_reason: null,
      customer_cancellation_comment: null,
      metadata: metadata ?? { org: organizationId },
      custom_field_data: {},
      customer: {
        id: `cus_${externalSubscriptionId}`,
        created_at: "2026-01-01T00:00:00.000Z",
        modified_at: null,
        metadata: {},
        external_id: organizationId,
        email: "user@example.com",
        email_verified: true,
        type: "individual",
        name: "Test User",
        billing_address: null,
        tax_id: null,
        organization_id: "polar_org",
        deleted_at: null,
        avatar_url: "",
      },
      product: {
        id: productId,
        created_at: "2026-01-01T00:00:00.000Z",
        modified_at: null,
        trial_interval: null,
        trial_interval_count: null,
        name: "Starter monthly",
        description: null,
        visibility: "public",
        recurring_interval: "month",
        recurring_interval_count: 1,
        is_recurring: true,
        is_archived: false,
        organization_id: "polar_org",
        metadata: { plan: "starter", variant: "monthly" },
        prices: [],
        benefits: [],
        medias: [],
        attached_custom_fields: [],
      },
      discount: null,
      prices: [],
      meters: [],
      pending_update: null,
    })
  );
  assert(result.ok, "subscription fixture must decode");
  return result.value;
};

const makeWorkspace = () =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const productId = `prod_${organizationId}`;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "Test organization",
      slug: organizationId,
      createdAt: now,
    });
    yield* db.insert(schema.productTable).values({
      id: productId,
      name: "Starter monthly",
      isRecurring: true,
      isArchived: false,
      externalOrganizationId: "polar_org",
      visibility: "public",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      metadata: { plan: "starter", variant: "monthly" },
      createdAt: now,
      updatedAt: now,
    });

    return { organizationId, productId, now };
  });

const insertSubscription = ({
  externalId,
  organizationId,
  productId,
  status = "active",
  now,
}: {
  externalId: string;
  organizationId: string;
  productId: string;
  status?: "active" | "past_due" | "canceled";
  now: Date;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db.insert(schema.subscriptionTable).values({
      id: `sub_${externalId}`,
      externalId,
      organizationId,
      amount: 2900,
      cancelAtPeriodEnd: false,
      currency: "usd",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      status,
      currentPeriodStart: now,
      currentPeriodEnd: DateTime.toDateUtc(
        DateTime.addDuration(DateTime.fromDateUnsafe(now), Duration.days(30))
      ),
      customerId: `cus_${externalId}`,
      productId,
      createdAt: now,
    });
  });

const TestLayer = BillingRepository.layer.pipe(
  Layer.provideMerge(Database.PgliteDatabaseLive)
);

/** Mutable state for the fake Polar revoke call. */
type PolarServiceTestState = {
  calls: string[];
  fail: boolean;
  alreadyRevoked: boolean;
};

/**
 * Effect-free state on purpose: a test needs to flip it between passes, and
 * the pass under test is the only thing running against it at a time.
 */
const polarState: PolarServiceTestState = {
  calls: [],
  fail: false,
  alreadyRevoked: false,
};

/**
 * The service needs a real client value when configured so the queue can tell
 * "Polar is configured" from "billing was turned off after the workspace was
 * deleted". The client is constructed but never called; every method is
 * replaced below.
 */
const fakePolarClient = new Polar({ accessToken: "test-token" });

const fakePolarService = (
  client: Polar | undefined,
  target: "sandbox" | "production" = "sandbox"
) => ({
  client,
  target,
  webhookSecret: Option.none(),
  createCheckout: () =>
    Effect.succeed({ url: "https://example.test/checkout" }),
  createPortal: ({ customerId }: { customerId: string }) =>
    Effect.succeed({ url: `https://example.test/portal/${customerId}` }),
  revokeSubscription: ({ id }: { id: string }) =>
    Effect.suspend(() => {
      polarState.calls.push(id);
      return polarState.fail
        ? Effect.fail(
            new FailedToRevokeSubscriptionError({
              message: polarState.alreadyRevoked
                ? "Polar says the subscription is already canceled"
                : "Polar unreachable",
              ...(polarState.alreadyRevoked && { alreadyRevoked: true }),
            })
          )
        : Effect.void;
    }),
});

const RevocationTestLayer = Layer.mergeAll(
  BillingRepository.layer,
  Layer.succeed(PolarService, fakePolarService(fakePolarClient))
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

const UnconfiguredRevocationTestLayer = Layer.mergeAll(
  BillingRepository.layer,
  Layer.succeed(PolarService, fakePolarService(undefined))
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

describe("BillingRepository", () => {
  layer(TestLayer)("subscriptions", (it) => {
    it.effect("upserts a subscription in place on repeat delivery", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId } = yield* makeWorkspace();

        yield* repository.upsertSubscription(
          makeSubscriptionPayload({
            externalSubscriptionId: "sub_upsert",
            organizationId,
            productId,
          }),
          instant("2026-01-02T00:00:00.000Z")
        );
        const [inserted] = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, "sub_upsert"));

        yield* repository.upsertSubscription(
          makeSubscriptionPayload({
            externalSubscriptionId: "sub_upsert",
            organizationId,
            productId,
            status: "past_due",
          }),
          instant("2026-01-03T00:00:00.000Z")
        );
        const rows = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, "sub_upsert"));

        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(inserted?.id);
        expect(rows[0]?.status).toBe("past_due");
        expect(rows[0]?.lastEventAt?.toISOString()).toBe(
          "2026-01-03T00:00:00.000Z"
        );
      })
    );

    it.effect("maps a status the database does not know to incomplete", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId } = yield* makeWorkspace();

        yield* repository.upsertSubscription(
          makeSubscriptionPayload({
            externalSubscriptionId: "sub_paused",
            organizationId,
            productId,
            status: "paused",
          }),
          instant("2026-01-02T00:00:00.000Z")
        );

        const [row] = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, "sub_paused"));
        expect(row?.status).toBe("incomplete");
      })
    );

    it.effect("ignores a subscription without a workspace in metadata", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId } = yield* makeWorkspace();

        const exit = yield* Effect.exit(
          repository.upsertSubscription(
            makeSubscriptionPayload({
              externalSubscriptionId: "sub_no_org",
              organizationId,
              productId,
              metadata: {},
            }),
            instant("2026-01-02T00:00:00.000Z")
          )
        );

        expect(exit._tag).toBe("Success");
        const rows = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, "sub_no_org"));
        expect(rows).toHaveLength(0);
      })
    );

    it.effect("ignores a subscription whose workspace is already gone", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId } = yield* makeWorkspace();

        const exit = yield* Effect.exit(
          repository.upsertSubscription(
            makeSubscriptionPayload({
              externalSubscriptionId: "sub_deleted_org",
              organizationId: "workspace_that_was_deleted",
              productId,
            }),
            instant("2026-01-02T00:00:00.000Z")
          )
        );

        expect(exit._tag).toBe("Success");
        const rows = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.organizationId, organizationId));
        expect(rows).toHaveLength(0);
      })
    );

    it.effect("keeps the newer state when events arrive out of order", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId } = yield* makeWorkspace();

        yield* repository.upsertSubscription(
          makeSubscriptionPayload({
            externalSubscriptionId: "sub_out_of_order",
            organizationId,
            productId,
            status: "canceled",
          }),
          instant("2026-01-05T00:00:00.000Z")
        );
        yield* repository.upsertSubscription(
          makeSubscriptionPayload({
            externalSubscriptionId: "sub_out_of_order",
            organizationId,
            productId,
            status: "active",
          }),
          instant("2026-01-01T00:00:00.000Z")
        );

        const [row] = yield* db
          .select()
          .from(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.externalId, "sub_out_of_order"));
        expect(row?.status).toBe("canceled");
        expect(row?.lastEventAt?.toISOString()).toBe(
          "2026-01-05T00:00:00.000Z"
        );
      })
    );
  });

  layer(TestLayer)("revocation queue", (it) => {
    it.effect(
      "enqueues every subscription and only revokes after the org is gone",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_queue_a",
            organizationId,
            productId,
            now,
          });
          yield* insertSubscription({
            externalId: "sub_queue_b",
            organizationId,
            productId,
            now,
          });

          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
            polarServer: "sandbox",
          });

          // The workspace still exists: nothing may be revoked yet, which is
          // what makes a rolled-back deletion safe.
          const whileAlive =
            yield* repository.findPendingSubscriptionRevocations({
              organizationId,
              limit: 10,
            });
          expect(whileAlive).toHaveLength(0);

          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          const afterDelete =
            yield* repository.findPendingSubscriptionRevocations({
              organizationId,
              limit: 10,
            });
          expect(
            afterDelete.map((row) => row.externalSubscriptionId).sort()
          ).toEqual(["sub_queue_a", "sub_queue_b"]);

          yield* repository.markSubscriptionRevocationSucceeded({
            externalSubscriptionId: "sub_queue_a",
          });
          const afterSuccess =
            yield* repository.findPendingSubscriptionRevocations({
              organizationId,
              limit: 10,
            });
          expect(afterSuccess.map((row) => row.externalSubscriptionId)).toEqual(
            ["sub_queue_b"]
          );

          yield* repository.markSubscriptionRevocationFailed({
            externalSubscriptionId: "sub_queue_b",
            message: "Polar unreachable",
          });
          const [failed] = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_queue_b"
              )
            );
          expect(failed?.attempts).toBe(1);
          expect(failed?.lastError).toBe("Polar unreachable");
          expect(failed?.revokedAt).toBeNull();
        })
    );

    it.effect("is idempotent when the same workspace is enqueued twice", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_queue_twice",
          organizationId,
          productId,
          now,
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
          polarServer: "sandbox",
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
          polarServer: "sandbox",
        });

        const queued = yield* db
          .select()
          .from(schema.subscriptionRevocationTable)
          .where(
            eq(
              schema.subscriptionRevocationTable.organizationId,
              organizationId
            )
          );
        expect(queued).toHaveLength(1);
      })
    );
  });

  layer(TestLayer)("plan resolution", (it) => {
    it.effect("returns every subscription a workspace holds", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_all_a",
          organizationId,
          productId,
          now,
        });
        yield* insertSubscription({
          externalId: "sub_all_b",
          organizationId,
          productId,
          status: "canceled",
          now,
        });

        const subscriptions =
          yield* repository.findSubscriptionsByOrganizationId({
            organizationId,
          });
        expect(subscriptions.map((row) => row.externalId).sort()).toEqual([
          "sub_all_a",
          "sub_all_b",
        ]);
      })
    );

    it.effect("ignores canceled and expired past-due subscriptions", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_canceled",
          organizationId,
          productId,
          status: "canceled",
          now,
        });
        yield* insertSubscription({
          externalId: "sub_expired_past_due",
          organizationId,
          productId,
          status: "past_due",
          now,
        });
        yield* db
          .update(schema.subscriptionTable)
          .set({
            // The TestClock starts at the epoch, so "expired" is measured
            // against that clock, not wall time.
            currentPeriodEnd: DateTime.toDateUtc(
              DateTime.addDuration(
                DateTime.fromDateUnsafe(now),
                Duration.days(-1)
              )
            ),
          })
          .where(
            eq(schema.subscriptionTable.externalId, "sub_expired_past_due")
          );

        const current =
          yield* repository.findCurrentSubscriptionByOrganizationId({
            organizationId,
          });
        expect(Option.isNone(current)).toBe(true);
      })
    );

    it.effect(
      "prefers the currently entitled subscription for the portal",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_portal_canceled",
            organizationId,
            productId,
            status: "canceled",
            now,
          });
          yield* insertSubscription({
            externalId: "sub_portal_active",
            organizationId,
            productId,
            status: "active",
            now,
          });

          const found = yield* repository.findSubscriptionByOrganizationId({
            organizationId,
          });
          expect(Option.getOrNull(found)?.externalId).toBe("sub_portal_active");
        })
    );

    it.effect("rejects archived and variant-mismatched checkout products", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { productId, now } = yield* makeWorkspace();

        const eligible = yield* repository.findCheckoutProduct({ productId });
        expect(Option.isSome(eligible)).toBe(true);

        yield* db
          .update(schema.productTable)
          .set({ metadata: { plan: "starter", variant: "yearly" } })
          .where(eq(schema.productTable.id, productId));
        const mismatched = yield* repository.findCheckoutProduct({ productId });
        expect(Option.isNone(mismatched)).toBe(true);

        yield* db
          .update(schema.productTable)
          .set({
            metadata: { plan: "starter", variant: "monthly" },
            isArchived: true,
            updatedAt: now,
          })
          .where(eq(schema.productTable.id, productId));
        const archived = yield* repository.findCheckoutProduct({ productId });
        expect(Option.isNone(archived)).toBe(true);
      })
    );
  });

  layer(RevocationTestLayer)("revocation retry", (it) => {
    it.effect("revokes a queued subscription and records the success", () =>
      Effect.gen(function* () {
        polarState.calls = [];
        polarState.fail = false;
        polarState.alreadyRevoked = false;
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_revocation_ok",
          organizationId,
          productId,
          now,
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
          polarServer: "sandbox",
        });
        yield* db
          .delete(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId));

        yield* revokePendingSubscriptionRevocations({ organizationId });

        const [row] = yield* db
          .select()
          .from(schema.subscriptionRevocationTable)
          .where(
            eq(
              schema.subscriptionRevocationTable.externalSubscriptionId,
              "sub_revocation_ok"
            )
          );
        expect(row?.revokedAt).not.toBeNull();
        expect(row?.attempts).toBe(0);
        expect(polarState.calls).toEqual(["sub_revocation_ok"]);
      })
    );

    it.effect("keeps a failed revocation queued until Polar recovers", () =>
      Effect.gen(function* () {
        polarState.calls = [];
        polarState.fail = true;
        polarState.alreadyRevoked = false;
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_revocation_retry",
          organizationId,
          productId,
          now,
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
          polarServer: "sandbox",
        });
        yield* db
          .delete(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId));

        yield* revokePendingSubscriptionRevocations({ organizationId });

        const [failed] = yield* db
          .select()
          .from(schema.subscriptionRevocationTable)
          .where(
            eq(
              schema.subscriptionRevocationTable.externalSubscriptionId,
              "sub_revocation_retry"
            )
          );
        expect(failed?.revokedAt).toBeNull();
        expect(failed?.attempts).toBe(1);
        expect(failed?.lastError).toBe("Polar unreachable");

        polarState.fail = false;
        yield* revokePendingSubscriptionRevocations({ organizationId });

        const pending = yield* repository.findPendingSubscriptionRevocations({
          organizationId,
          limit: 10,
        });
        expect(pending).toHaveLength(0);
        expect(polarState.calls).toEqual([
          "sub_revocation_retry",
          "sub_revocation_retry",
        ]);
      })
    );

    it.effect(
      "leaves a queued revocation pending when its originating target is not configured",
      () =>
        Effect.gen(function* () {
          polarState.calls = [];
          polarState.fail = false;
          polarState.alreadyRevoked = false;
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_revocation_other_target",
            organizationId,
            productId,
            now,
          });
          // The queue row belongs to production while the configured client is
          // sandbox: a 404 from sandbox would say nothing about the row.
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
            polarServer: "production",
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          yield* revokePendingSubscriptionRevocations({ organizationId });

          const [row] = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_revocation_other_target"
              )
            );
          expect(row?.revokedAt).toBeNull();
          expect(row?.attempts).toBe(0);
          expect(polarState.calls).toEqual([]);

          const pending = yield* repository.findPendingSubscriptionRevocations({
            organizationId,
            limit: 10,
          });
          expect(pending.map((item) => item.externalSubscriptionId)).toEqual([
            "sub_revocation_other_target",
          ]);
        })
    );

    it.effect(
      "closes a queued revocation Polar reports as already terminated",
      () =>
        Effect.gen(function* () {
          polarState.calls = [];
          polarState.fail = true;
          polarState.alreadyRevoked = true;
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_revocation_already",
            organizationId,
            productId,
            now,
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
            polarServer: "sandbox",
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          yield* revokePendingSubscriptionRevocations({ organizationId });

          const [row] = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_revocation_already"
              )
            );
          expect(row?.revokedAt).not.toBeNull();
          expect(row?.attempts).toBe(0);
          expect(row?.lastError).toBeNull();

          const pending = yield* repository.findPendingSubscriptionRevocations({
            organizationId,
            limit: 10,
          });
          expect(pending).toHaveLength(0);
          expect(polarState.calls).toEqual(["sub_revocation_already"]);
        })
    );
  });

  layer(UnconfiguredRevocationTestLayer)("revocation without billing", (it) => {
    it.effect("leaves the queue pending when Polar is not configured", () =>
      Effect.gen(function* () {
        const repository = yield* BillingRepository;
        const db = yield* currentDb;
        const { organizationId, productId, now } = yield* makeWorkspace();

        yield* insertSubscription({
          externalId: "sub_revocation_unconfigured",
          organizationId,
          productId,
          now,
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
          polarServer: "sandbox",
        });
        yield* db
          .delete(schema.organizationTable)
          .where(eq(schema.organizationTable.id, organizationId));

        yield* revokePendingSubscriptionRevocations({ organizationId });

        const pending = yield* repository.findPendingSubscriptionRevocations({
          organizationId,
          limit: 10,
        });
        expect(pending.map((row) => row.externalSubscriptionId)).toEqual([
          "sub_revocation_unconfigured",
        ]);
      })
    );
  });
});
