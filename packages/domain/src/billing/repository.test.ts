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
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import { FailedToRevokeSubscriptionError } from "./errors";
import { BillingRepository } from "./repository";
import {
  revokePendingSubscriptionRevocations,
  revokeQueuedSubscription,
  subscriptionRevocationMaintenance,
} from "./revocation";
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
  polarServer,
}: {
  externalId: string;
  organizationId: string;
  productId: string;
  status?: "active" | "past_due" | "canceled";
  now: Date;
  /** Simulates a row synced from a different Polar target than the test's. */
  polarServer?: string;
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
      ...(polarServer !== undefined && { polarServer }),
      createdAt: now,
    });
  });

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
 * Advances the test clock until `check` holds. Each pass is a handful of
 * PGlite statements, so the loop steps in 30-second increments — well past
 * the five-minute retry interval — and dies the test if the condition never
 * lands, rather than hanging. Polling the observable state (not the call
 * count alone) is deliberate: a pass that runs while Polar is still down
 * counts as a call but must not be mistaken for the recovering pass.
 */
const waitUntil = <E>(check: Effect.Effect<boolean, E>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (yield* check) {
        return;
      }
      yield* TestClock.adjust(Duration.seconds(30));
    }
    return yield* Effect.die(
      "the revocation loop did not reach the expected state within the virtual clock budget"
    );
  });

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
  getOrganizationSettings: () => Effect.succeedNone,
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

const fakeConfiguredPolar = fakePolarService(fakePolarClient);
const fakeUnconfiguredPolar = fakePolarService(undefined);

const RevocationTestLayer = Layer.mergeAll(
  BillingRepository.layer.pipe(
    Layer.provide(Layer.succeed(PolarService, fakeConfiguredPolar))
  ),
  // Exposed as well as provided: the revocation pass reads the service
  // directly.
  Layer.succeed(PolarService, fakeConfiguredPolar)
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

const UnconfiguredRevocationTestLayer = Layer.mergeAll(
  BillingRepository.layer.pipe(
    Layer.provide(Layer.succeed(PolarService, fakeUnconfiguredPolar))
  ),
  Layer.succeed(PolarService, fakeUnconfiguredPolar)
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

/** The repository's own layer, with the fake Polar service it now reads the target from. */
const TestLayer = Layer.mergeAll(
  BillingRepository.layer.pipe(
    Layer.provide(Layer.succeed(PolarService, fakeConfiguredPolar))
  ),
  Layer.succeed(PolarService, fakeConfiguredPolar)
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
        expect(rows[0]?.polarServer).toBe("sandbox");
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

    it.effect(
      "queues a revocation when a live subscription reports for a deleted workspace",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { productId } = yield* makeWorkspace();

          // A workspace id this deployment minted, whose row is already
          // gone — the shape of a subscription.created that had not landed
          // before the deletion committed.
          const deletedWorkspaceId = yield* WorkspaceId.generate;

          const exit = yield* Effect.exit(
            repository.upsertSubscription(
              makeSubscriptionPayload({
                externalSubscriptionId: "sub_revive_deleted",
                organizationId: deletedWorkspaceId,
                productId,
              }),
              instant("2026-01-02T00:00:00.000Z")
            )
          );

          expect(exit._tag).toBe("Success");
          const subscriptionRows = yield* db
            .select()
            .from(schema.subscriptionTable)
            .where(
              eq(schema.subscriptionTable.externalId, "sub_revive_deleted")
            );
          expect(subscriptionRows).toHaveLength(0);

          const queued = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_revive_deleted"
              )
            );
          expect(queued).toHaveLength(1);
          expect(queued[0]?.organizationId).toBe(deletedWorkspaceId);
          expect(queued[0]?.polarServer).toBe("sandbox");
          expect(queued[0]?.revokedAt).toBeNull();
        })
    );

    it.effect(
      "does not queue a revocation for an id that merely looks like a workspace id",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { productId } = yield* makeWorkspace();

          // Passes the prefix and charset shape check but not the legid
          // checksum this deployment's ids embed — the refinement the queue
          // decision rests on.
          expect(WorkspaceId.is("org_a")).toBe(true);
          expect(yield* WorkspaceId.verify("org_a")).toBe(false);

          const exit = yield* Effect.exit(
            repository.upsertSubscription(
              makeSubscriptionPayload({
                externalSubscriptionId: "sub_lookalike_org",
                organizationId: "org_a",
                productId,
              }),
              instant("2026-01-02T00:00:00.000Z")
            )
          );

          expect(exit._tag).toBe("Success");
          const queued = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_lookalike_org"
              )
            );
          expect(queued).toHaveLength(0);
        })
    );

    it.effect(
      "does not queue a revocation for foreign metadata on a deleted workspace",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { productId } = yield* makeWorkspace();

          const exit = yield* Effect.exit(
            repository.upsertSubscription(
              makeSubscriptionPayload({
                externalSubscriptionId: "sub_foreign_org",
                organizationId: "someone_elses_workspace",
                productId,
              }),
              instant("2026-01-02T00:00:00.000Z")
            )
          );

          expect(exit._tag).toBe("Success");
          const queued = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_foreign_org"
              )
            );
          expect(queued).toHaveLength(0);
        })
    );

    it.effect(
      "does not duplicate a revocation the deletion already queued",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_requeued",
            organizationId,
            productId,
            now,
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          // The deletion queued its revocation and closed it; a late webhook
          // for the same subscription must not re-open the closed row.
          yield* repository.markSubscriptionRevocationSucceeded({
            externalSubscriptionId: "sub_requeued",
          });
          yield* repository.upsertSubscription(
            makeSubscriptionPayload({
              externalSubscriptionId: "sub_requeued",
              organizationId,
              productId,
            }),
            instant("2026-01-02T00:00:00.000Z")
          );

          const queued = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_requeued"
              )
            );
          expect(queued).toHaveLength(1);
          expect(queued[0]?.revokedAt).not.toBeNull();
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
        });
        yield* repository.enqueueSubscriptionRevocationsForOrganization({
          organizationId,
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
      "excludes revocations whose originating target is not the configured one from the sweep",
      () =>
        Effect.gen(function* () {
          polarState.calls = [];
          polarState.fail = false;
          polarState.alreadyRevoked = false;
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          // The subscription (and therefore the queue row) belongs to
          // production while the configured client is sandbox: a 404 from
          // sandbox would say nothing about the row, so the sweep query
          // excludes it instead of the caller skipping it — a stale batch of
          // mismatched rows cannot occupy the sweep's batch window.
          yield* insertSubscription({
            externalId: "sub_revocation_other_target",
            organizationId,
            productId,
            now,
            polarServer: "production",
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          const queuedRow = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_revocation_other_target"
              )
            );
          expect(queuedRow[0]?.polarServer).toBe("production");

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

    it.effect(
      "leaves a revocation pending when it is handed to the wrong target directly",
      () =>
        Effect.gen(function* () {
          polarState.calls = [];
          polarState.fail = false;
          polarState.alreadyRevoked = false;
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_guard_mismatch",
            organizationId,
            productId,
            now,
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
          });

          // Direct callers bypass the sweep's target filter, so the queue row
          // processor keeps its own check: a 404 from a server that never held
          // the subscription is not evidence it is gone.
          yield* revokeQueuedSubscription({
            externalSubscriptionId: "sub_guard_mismatch",
            organizationId,
            polarServer: "production",
          });

          const [row] = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_guard_mismatch"
              )
            );
          expect(row?.revokedAt).toBeNull();
          expect(row?.attempts).toBe(0);
          expect(polarState.calls).toEqual([]);
        })
    );

    it.effect(
      "the maintenance loop keeps retrying the queue on its schedule",
      () =>
        Effect.gen(function* () {
          polarState.calls = [];
          polarState.fail = true;
          polarState.alreadyRevoked = false;
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_maintenance",
            organizationId,
            productId,
            now,
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          // The first pass runs immediately and Polar is unreachable. The
          // shared PGlite keeps pending rows from earlier tests, so the sweep
          // services them first; wait until this row's own call has happened
          // before the flip, or a recovering pass could precede the failing
          // one and leave it only one call.
          const fiber = yield* Effect.forkScoped(
            subscriptionRevocationMaintenance
          );
          yield* waitUntil(
            Effect.sync(() => polarState.calls.includes("sub_maintenance"))
          );

          // Polar recovers; the next scheduled pass closes the row.
          polarState.fail = false;
          yield* waitUntil(
            Effect.map(
              repository.findPendingSubscriptionRevocations({
                organizationId,
                limit: 10,
              }),
              (pending) => pending.length === 0
            )
          );
          // The shared PGlite keeps pending rows from earlier tests, so the
          // sweep services them too; the assertion is this poll's two calls.
          expect(
            polarState.calls.filter((id) => id === "sub_maintenance")
          ).toEqual(["sub_maintenance", "sub_maintenance"]);

          // Interruption must still reach the loop: it is caught neither as a
          // typed failure nor as a defect, so the fiber dies with its scope
          // instead of spinning.
          yield* Fiber.interrupt(fiber);
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

    it.effect(
      "leaves a single queued revocation pending when the pass is invoked directly",
      () =>
        Effect.gen(function* () {
          const repository = yield* BillingRepository;
          const db = yield* currentDb;
          const { organizationId, productId, now } = yield* makeWorkspace();

          yield* insertSubscription({
            externalId: "sub_direct_unconfigured",
            organizationId,
            productId,
            now,
          });
          yield* repository.enqueueSubscriptionRevocationsForOrganization({
            organizationId,
          });
          yield* db
            .delete(schema.organizationTable)
            .where(eq(schema.organizationTable.id, organizationId));

          yield* revokeQueuedSubscription({
            externalSubscriptionId: "sub_direct_unconfigured",
            organizationId,
            polarServer: "sandbox",
          });

          const [row] = yield* db
            .select()
            .from(schema.subscriptionRevocationTable)
            .where(
              eq(
                schema.subscriptionRevocationTable.externalSubscriptionId,
                "sub_direct_unconfigured"
              )
            );
          expect(row?.revokedAt).toBeNull();
          expect(row?.attempts).toBe(0);
        })
    );
  });
});
