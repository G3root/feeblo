import { Database, schema } from "@feeblo/db";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { RoadmapColumnRepository } from "@feeblo/domain/roadmap-column/repository";
import { RoadmapRepository } from "@feeblo/domain/roadmap/repository";
import { RoadmapColumnId, RoadmapId, WorkspaceId } from "@feeblo/id";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** Test-only mailbox router; returns every message the test mailer rendered. */
export const testMailboxRouter = (mailbox: Ref.Ref<TestMailerState>) =>
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/__e2e/emails",
      Effect.gen(function* () {
        const state = yield* Ref.get(mailbox);
        return yield* HttpServerResponse.json({
          emails: state.renderedMessages,
        });
      }).pipe(Effect.orDie)
    )
  );

const SeedRoadmapColumn = Schema.Struct({
  name: Schema.String.check(Schema.isLengthBetween(1, 120)),
  status: Schema.Literals(schema.POST_STATUS_TYPES),
});

const SeedRoadmapPayload = Schema.Struct({
  organizationId: WorkspaceId.schema,
  name: Schema.String.check(Schema.isLengthBetween(1, 120)),
  slug: Schema.String.check(Schema.isLengthBetween(1, 120)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: Schema.optional(Schema.Literals(["public", "private"])),
  columns: Schema.Array(SeedRoadmapColumn).check(Schema.isLengthBetween(1, 20)),
});

/**
 * Test-only seeding route. Mounted next to the test mailbox router only when
 * the server runs with E2E_TEST_MAILER=true, so production never serves it.
 * Lets Playwright specs give a workspace extra status roadmaps without going
 * through roadmap CRUD (intentionally disabled until phase 2).
 */
export const e2eRoadmapSeedRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const postStatuses = yield* PostStatusRepository;
    const roadmaps = yield* RoadmapRepository;
    const columns = yield* RoadmapColumnRepository;

    return yield* router.add("POST", "/__e2e/seed-roadmap", (request) =>
      Effect.gen(function* () {
        const body = yield* request.json;
        const payload =
          yield* Schema.decodeUnknownEffect(SeedRoadmapPayload)(body);

        const statuses = yield* postStatuses.findMany({
          organizationId: payload.organizationId,
        });
        const statusIdByType = new Map(
          statuses.map((status) => [status.type, status.id])
        );

        const unknownStatuses = payload.columns.flatMap((column) =>
          statusIdByType.has(column.status) ? [] : [column.status]
        );
        if (unknownStatuses.length > 0) {
          return HttpServerResponse.jsonUnsafe(
            {
              error: `Unknown status types for organization: ${unknownStatuses.join(", ")}`,
            },
            { status: 400 }
          );
        }

        const roadmapId = yield* RoadmapId.generate;
        yield* roadmaps.create({
          id: roadmapId,
          organizationId: payload.organizationId,
          name: payload.name,
          slug: payload.slug,
          description: payload.description ?? null,
          isPrimary: false,
          mode: "status",
          visibility: payload.visibility ?? "public",
          filter: { version: 1, operator: "and", conditions: [] },
        });

        for (const [position, column] of payload.columns.entries()) {
          const statusId = statusIdByType.get(column.status);
          if (!statusId) {
            continue;
          }

          const columnId = yield* RoadmapColumnId.generate;
          yield* columns.create({
            id: columnId,
            organizationId: payload.organizationId,
            roadmapId,
            name: column.name,
            position,
            config: { type: "status", statusId },
          });
        }

        return HttpServerResponse.jsonUnsafe({ roadmapId });
      }).pipe(Effect.orDie)
    );
  })
).pipe(
  Layer.provide(
    Layer.mergeAll(
      RoadmapRepository.layer,
      RoadmapColumnRepository.layer,
      PostStatusRepository.layer
    )
  ),
  Layer.provide(Database.DatabaseContextLive),
  Layer.orDie
);

const SetPlanPayload = Schema.Struct({
  organizationId: WorkspaceId.schema,
  plan: Schema.Literals(["starter", "professional"]),
});

/**
 * Test-only plan seeding route. Mounted next to the test mailbox router only
 * when the server runs with E2E_TEST_MAILER=true, so production never serves
 * it. Lets Playwright specs put a workspace on a paid plan (Starter or
 * Professional) so entitlement-gated features like widget SSO can be tested
 * end-to-end without going through the Polar checkout flow.
 */
export const e2eSetPlanRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    return yield* router.add("POST", "/__e2e/set-plan", (request) =>
      Effect.gen(function* () {
        const body = yield* request.json;
        const payload = yield* Schema.decodeUnknownEffect(SetPlanPayload)(body);
        const now = new Date();

        // Converge on the requested plan: drop any existing subscription so
        // re-runs never stack multiple active rows for the same workspace.
        // The product row goes with it (subscription.productId cascades).
        yield* db
          .delete(schema.subscriptionTable)
          .where(
            eq(schema.subscriptionTable.organizationId, payload.organizationId)
          );

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
).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);
