import { currentDb, schema } from "@feeblo/db";
import { and, asc, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
    create: ({
      organizationId: _organizationId,
      ...input
    }: TRoadmapColumnCreate) =>
      db
        .insert(schema.roadmapColumnTable)
        .values({ ...input, config: toMutableColumnConfig(input.config) })
        .pipe(Effect.asVoid),
    update: ({
      organizationId: _organizationId,
      ...input
    }: TRoadmapColumnUpdate) =>
      db
        .update(schema.roadmapColumnTable)
        .set({
          name: input.name,
          position: input.position,
          config: toMutableColumnConfig(input.config),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.roadmapColumnTable.id, input.id),
            eq(schema.roadmapColumnTable.roadmapId, input.roadmapId)
          )
        )
        .pipe(Effect.asVoid),
    delete: ({
      id,
      roadmapId,
      organizationId: _organizationId,
    }: TRoadmapColumnDelete) =>
      db
        .delete(schema.roadmapColumnTable)
        .where(
          and(
            eq(schema.roadmapColumnTable.id, id),
            eq(schema.roadmapColumnTable.roadmapId, roadmapId)
          )
        )
        .pipe(Effect.asVoid),
  };
});
export class RoadmapColumnRepository extends Context.Service<RoadmapColumnRepository>()(
  "RoadmapColumnRepository",
  { make: makeRoadmapColumnRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
