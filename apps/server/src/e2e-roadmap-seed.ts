import { Database, schema } from "@feeblo/db";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { RoadmapColumnRepository } from "@feeblo/domain/roadmap-column/repository";
import { RoadmapRepository } from "@feeblo/domain/roadmap/repository";
import { RoadmapColumnId, RoadmapId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Test-only seeding route. Mounted next to the test mailbox router only when
 * the server runs with E2E_TEST_MAILER=true, so production never serves it.
 * Lets Playwright specs give a workspace extra status roadmaps without going
 * through roadmap CRUD (intentionally disabled until phase 2).
 */

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
