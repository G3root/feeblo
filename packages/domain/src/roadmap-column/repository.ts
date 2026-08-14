import { currentDb, schema } from "@feeblo/db";
import { and, asc, eq, exists } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { PolicyDeniedError } from "../policy";
import { toMutableRoadmapFilter } from "../roadmap/repository";
import type { TRoadmapVisibility } from "../roadmap/schema";
import type {
  TRoadmapColumnConfig,
  TRoadmapColumnCreate,
  TRoadmapColumnDelete,
  TRoadmapColumnList,
  TRoadmapColumnUpdate,
} from "./schema";

const toMutableColumnConfig = (config: TRoadmapColumnConfig) =>
  config.type === "status"
    ? { type: config.type, statusId: config.statusId }
    : {
        type: config.type,
        filter: toMutableRoadmapFilter(config.filter),
      };

const makeRoadmapColumnRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  return {
    findMany: ({
      organizationId,
      visibility,
    }: TRoadmapColumnList & { visibility?: TRoadmapVisibility }) =>
      db
        .select({
          id: schema.roadmapColumnTable.id,
          roadmapId: schema.roadmapColumnTable.roadmapId,
          name: schema.roadmapColumnTable.name,
          position: schema.roadmapColumnTable.position,
          config: schema.roadmapColumnTable.config,
          createdAt: schema.roadmapColumnTable.createdAt,
          updatedAt: schema.roadmapColumnTable.updatedAt,
        })
        .from(schema.roadmapColumnTable)
        .innerJoin(
          schema.roadmapTable,
          eq(schema.roadmapColumnTable.roadmapId, schema.roadmapTable.id)
        )
        .where(
          and(
            eq(schema.roadmapTable.organizationId, organizationId),
            eq(schema.roadmapTable.mode, "status"),
            visibility
              ? eq(schema.roadmapTable.visibility, visibility)
              : undefined
          )
        )
        .orderBy(asc(schema.roadmapColumnTable.position))
        .pipe(
          Effect.map((columns) =>
            columns.flatMap(({ config, ...column }) => {
              if (config.type !== "status") {
                return [];
              }

              return [{ ...column, statusId: config.statusId }];
            })
          )
        ),
    create: ({ organizationId, ...input }: TRoadmapColumnCreate) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const roadmap = yield* tx
              .select({ id: schema.roadmapTable.id })
              .from(schema.roadmapTable)
              .where(
                and(
                  eq(schema.roadmapTable.id, input.roadmapId),
                  eq(schema.roadmapTable.organizationId, organizationId)
                )
              )
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isNone(roadmap)) {
              return yield* new PolicyDeniedError({
                reason: "Roadmap does not belong to this organization",
              });
            }

            yield* tx.insert(schema.roadmapColumnTable).values({
              ...input,
              config: toMutableColumnConfig(input.config),
            });
          })
        )
        .pipe(Effect.asVoid),
    update: ({ organizationId, ...input }: TRoadmapColumnUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [updated] = yield* db
          .update(schema.roadmapColumnTable)
          .set({
            name: input.name,
            position: input.position,
            config: toMutableColumnConfig(input.config),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.roadmapColumnTable.id, input.id),
              eq(schema.roadmapColumnTable.roadmapId, input.roadmapId),
              exists(
                db
                  .select({ id: schema.roadmapTable.id })
                  .from(schema.roadmapTable)
                  .where(
                    and(
                      eq(
                        schema.roadmapTable.id,
                        schema.roadmapColumnTable.roadmapId
                      ),
                      eq(schema.roadmapTable.organizationId, organizationId)
                    )
                  )
              )
            )
          )
          .returning({ id: schema.roadmapColumnTable.id });

        if (!updated) {
          return yield* new PolicyDeniedError({
            reason: "Roadmap column does not belong to this organization",
          });
        }
      }),
    delete: ({ id, roadmapId, organizationId }: TRoadmapColumnDelete) =>
      Effect.gen(function* () {
        const [deleted] = yield* db
          .delete(schema.roadmapColumnTable)
          .where(
            and(
              eq(schema.roadmapColumnTable.id, id),
              eq(schema.roadmapColumnTable.roadmapId, roadmapId),
              exists(
                db
                  .select({ id: schema.roadmapTable.id })
                  .from(schema.roadmapTable)
                  .where(
                    and(
                      eq(
                        schema.roadmapTable.id,
                        schema.roadmapColumnTable.roadmapId
                      ),
                      eq(schema.roadmapTable.organizationId, organizationId)
                    )
                  )
              )
            )
          )
          .returning({ id: schema.roadmapColumnTable.id });

        if (!deleted) {
          return yield* new PolicyDeniedError({
            reason: "Roadmap column does not belong to this organization",
          });
        }
      }),
  };
});
export class RoadmapColumnRepository extends Context.Service<RoadmapColumnRepository>()(
  "RoadmapColumnRepository",
  { make: makeRoadmapColumnRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
