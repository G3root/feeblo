import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { createCompanyOperation } from "../company/public-api/operations";
import { CompanyRepository } from "../company/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { WorkspaceRepository } from "../workspace/repository";
import { crmLimitMessage } from "./entitlement";
import { PlanRequiresUpgradeError } from "./errors";
import { PublicApiCaller } from "./middleware";

/** The `Date` for a known instant, built through `DateTime`. */
const dateAt = (instant: string | number | Date): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(instant));

/**
 * The CRM entry gate on the Public API's company create.
 *
 * The protocol — the lock, the count, and the plan decision — lives in
 * `crm-entry/intake.ts` and has its own suite; what is pinned here is this
 * surface's projection of it: the operation must answer a full CRM as
 * `PLAN_REQUIRES_UPGRADE` with the published message, and the count must be
 * the workspace's own contacts and companies. No plan that can use the Public
 * API has a cap today — the cap is on Free, and a Free workspace cannot create
 * a key — so the gate is exercised against the operation directly rather than
 * through a request, which the plan gate would refuse first. That is the
 * point: the surface must not drift the day a plan gains a cap.
 */

const TestLayer = Layer.mergeAll(
  CompanyRepository.layer,
  EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer)),
  WorkspaceRepository.layer
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

/** `PLAN_ENTITLEMENTS.free.limits.crmEntries`, restated so a change fails here. */
const FREE_CRM_ENTRY_LIMIT = 10;

const seedWorkspace = (plan: "free" | "starter") =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = yield* WorkspaceId.generate;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.organizationTable).values({
      id: organizationId,
      name: "CRM gate workspace",
      slug: organizationId,
      createdAt: now,
    });

    if (plan === "starter") {
      yield* db.insert(schema.productTable).values({
        id: `product_${organizationId}`,
        name: "Starter",
        isRecurring: true,
        isArchived: false,
        externalOrganizationId: "feeblo",
        visibility: "public",
        metadata: { plan: "starter", variant: "monthly" },
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.subscriptionTable).values({
        id: `subscription_${organizationId}`,
        externalId: `external_${organizationId}`,
        organizationId,
        amount: 1900,
        cancelAtPeriodEnd: false,
        currency: "usd",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: dateAt(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        customerId: `customer_${organizationId}`,
        productId: `product_${organizationId}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    return organizationId;
  });

/**
 * Seeds entries that count towards the limit, and only those: the ids are
 * derived from the workspace's, so the shared PGlite database the tests in this
 * file run against cannot collide.
 */
const seedCrmEntries = (args: {
  readonly organizationId: string;
  readonly companies: number;
  readonly contacts?: number;
}) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;

    yield* db.insert(schema.companyTable).values(
      Array.from({ length: args.companies }, (_, index) => ({
        id: `cmp_${args.organizationId}_${index}`,
        name: `Company ${index}`,
        organizationId: args.organizationId,
        createdAt: now,
        updatedAt: now,
      }))
    );

    const contacts = args.contacts ?? 0;
    if (contacts > 0) {
      yield* db.insert(schema.contactTable).values(
        Array.from({ length: contacts }, (_, index) => ({
          id: `cnt_${args.organizationId}_${index}`,
          name: `Contact ${index}`,
          organizationId: args.organizationId,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
  });

/** Runs the company create operation with a key scoped to it. */
const createCompany = (organizationId: string, name: string) =>
  createCompanyOperation.handler({ name }).pipe(
    Effect.provideService(PublicApiCaller, {
      keyId: "key_crm",
      organizationId,
      scopes: { companies: ["create"] },
      rateLimit: {
        limit: 300,
        remaining: 299,
        resetAfter: Duration.seconds(60),
      },
    })
  );

describe("public API CRM entry allowance", () => {
  layer(TestLayer)("the plan's CRM entry limit", (it) => {
    it.effect("allows a create while the workspace is under the limit", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedWorkspace("free");
        yield* seedCrmEntries({
          organizationId,
          companies: FREE_CRM_ENTRY_LIMIT - 1,
        });

        // One entry short of the cap, so the create the caller is about to make
        // is the one that fits.
        const created = yield* createCompany(organizationId, "Acme");

        expect(created.name).toBe("Acme");
      })
    );

    it.effect(
      "refuses a create once the limit is reached, as a plan upgrade",
      () =>
        Effect.gen(function* () {
          const organizationId = yield* seedWorkspace("free");
          yield* seedCrmEntries({
            organizationId,
            companies: FREE_CRM_ENTRY_LIMIT,
          });

          const error = yield* Effect.flip(
            createCompany(organizationId, "Acme")
          );

          expect(Schema.is(PlanRequiresUpgradeError)(error)).toBe(true);
          if (Schema.is(PlanRequiresUpgradeError)(error)) {
            expect(error.message).toBe(crmLimitMessage);
          }
        })
    );

    it.effect("counts contacts towards the limit as well as companies", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedWorkspace("free");
        // Companies alone are one short of the cap; a contact is what fills it.
        yield* seedCrmEntries({
          organizationId,
          companies: FREE_CRM_ENTRY_LIMIT - 1,
          contacts: 1,
        });

        const error = yield* Effect.flip(createCompany(organizationId, "Acme"));

        expect(error._tag).toBe("PLAN_REQUIRES_UPGRADE");
      })
    );

    it.effect("counts only the calling workspace's entries", () =>
      Effect.gen(function* () {
        const mine = yield* seedWorkspace("free");
        const theirs = yield* seedWorkspace("free");
        yield* seedCrmEntries({
          organizationId: theirs,
          companies: FREE_CRM_ENTRY_LIMIT,
        });

        const created = yield* createCompany(mine, "Acme");

        expect(created.name).toBe("Acme");
      })
    );

    it.effect("does not cap a plan whose CRM entry limit is null", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedWorkspace("starter");
        yield* seedCrmEntries({
          organizationId,
          companies: FREE_CRM_ENTRY_LIMIT * 2,
        });

        const created = yield* createCompany(organizationId, "Acme");

        expect(created.name).toBe("Acme");
      })
    );
  });
});
