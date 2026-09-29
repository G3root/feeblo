import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PublicApiCompanyRepository } from "../company/public-api/repository";
import { EmailOutboxConfig } from "../email-outbox/config";
import { EmailOutboxRepository } from "../email-outbox/repository";
import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { EmailSubscriptionTokenService } from "../email-subscription/tokens";
import { EntitlementPolicy } from "../entitlement/policies";
import { S3Test } from "../services/s3-test";
import { WorkspaceRepository } from "../workspace/repository";
import { requireCrmEntryAllowance } from "./entitlement";
import { PublicApiInternals } from "./router";

/**
 * The CRM entry gate on a company create.
 *
 * Companies and contacts count together against the plan's `crmEntries` limit,
 * exactly as the dashboard's own company create counts them. No plan that can
 * use the Public API has a cap today — the cap is on Free, and a Free workspace
 * cannot create a key — so the gate is exercised against the policy and the
 * count directly rather than through a request, which the plan gate would
 * refuse first. That is the point: the two surfaces must not drift apart the
 * day a plan gains a cap.
 */

const Entitlements = EntitlementPolicy.layer.pipe(
  Layer.provide(WorkspaceRepository.layer)
);

const TestLayer = Layer.mergeAll(
  // The surface's own private wiring, taken from the route rather than
  // restated (see ADR 0006): the company repository counts CRM entries
  // through the database the surface's internals already hold, so the test
  // supplies the same bundle the route does rather than a second one.
  PublicApiCompanyRepository.layer.pipe(
    Layer.provide(PublicApiInternals),
    Layer.provide(Entitlements),
    Layer.provide(S3Test),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      EmailSubscriptionRepository.layerWithoutDependencies.pipe(
        Layer.provide(
          EmailSubscriptionTokenService.layerTest(
            "public-api-test-signing-secret"
          )
        )
      )
    ),
    Layer.provide(
      EmailOutboxConfig.layerTest(new URL("https://app.feeblo.test"))
    )
  ),
  Entitlements,
  EmailOutboxRepository.layer,
  EmailOutboxConfig.layerTest(new URL("https://app.feeblo.test")),
  NodeCrypto.layer,
  WorkspaceRepository.layer
).pipe(Layer.provideMerge(Database.PgliteDatabaseLive));

/** `PLAN_ENTITLEMENTS.free.limits.crmEntries`, restated so a change fails here. */
const FREE_CRM_ENTRY_LIMIT = 10;

const seedWorkspace = (plan: "free" | "starter") =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const organizationId = `org_crm_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();

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
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
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
    const now = new Date();

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
        yield* requireCrmEntryAllowance(organizationId);
      })
    );

    it.effect("refuses a create once the limit is reached", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedWorkspace("free");
        yield* seedCrmEntries({
          organizationId,
          companies: FREE_CRM_ENTRY_LIMIT,
        });

        const error = yield* Effect.flip(
          requireCrmEntryAllowance(organizationId)
        );
        expect(error._tag).toBe("PLAN_REQUIRES_UPGRADE");
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

        const error = yield* Effect.flip(
          requireCrmEntryAllowance(organizationId)
        );
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

        yield* requireCrmEntryAllowance(mine);
      })
    );

    it.effect("does not cap a plan whose CRM entry limit is null", () =>
      Effect.gen(function* () {
        const organizationId = yield* seedWorkspace("starter");
        yield* seedCrmEntries({
          organizationId,
          companies: FREE_CRM_ENTRY_LIMIT * 2,
        });

        yield* requireCrmEntryAllowance(organizationId);
      })
    );
  });
});
