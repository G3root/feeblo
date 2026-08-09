import { Database, schema } from "@feeblo/db";
import { WorkspaceId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Test-only plan seeding route. Mounted next to the test mailbox router only
 * when the server runs with E2E_TEST_MAILER=true, so production never serves
 * it. Lets Playwright specs put a workspace on a paid plan (Starter or
 * Professional) so entitlement-gated features like widget SSO can be tested
 * end-to-end without going through the Polar checkout flow.
 */

const SetPlanPayload = Schema.Struct({
  organizationId: WorkspaceId.schema,
  plan: Schema.Literals(["starter", "professional"]),
});

export const e2eSetPlanRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    return yield* router.add("POST", "/__e2e/set-plan", (request) =>
      Effect.gen(function* () {
        const body = yield* request.json;
        const payload = yield* Schema.decodeUnknownEffect(SetPlanPayload)(
          body
        );
        const now = new Date();

        // Converge on the requested plan: drop any existing subscription so
        // re-runs never stack multiple active rows for the same workspace.
        // The product row goes with it (subscription.productId cascades).
        yield* db
          .delete(schema.subscriptionTable)
          .where(eq(schema.subscriptionTable.organizationId, payload.organizationId));

        const productId = `prod_e2e_${payload.organizationId}`;
        yield* db.insert(schema.productTable).values({
          id: productId,
          name:
            payload.plan === "starter"
              ? "Starter monthly"
              : "Professional monthly",
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "polar_org",
          visibility: "PUBLIC",
          recurringInterval: "month",
          recurringIntervalCount: 1,
          metadata: { plan: payload.plan, variant: "monthly" },
        });

        yield* db.insert(schema.subscriptionTable).values({
          id: `sub_e2e_${payload.organizationId}`,
          externalId: `sub_e2e_ext_${payload.organizationId}`,
          organizationId: payload.organizationId,
          amount: payload.plan === "starter" ? 4900 : 9900,
          cancelAtPeriodEnd: false,
          currency: "usd",
          recurringInterval: "month",
          recurringIntervalCount: 1,
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 86_400_000),
          customerId: `cus_e2e_${payload.organizationId}`,
          productId,
        });

        return HttpServerResponse.jsonUnsafe({ plan: payload.plan });
      }).pipe(Effect.orDie)
    );
  })
).pipe(
  Layer.provide(Database.DatabaseContextLive),
  Layer.orDie
);
