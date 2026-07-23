import { currentDb, schema } from "@feeblo/db";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  TRoadmapCreate,
  TRoadmapDelete,
  TRoadmapList,
  TRoadmapUpdate,
  TRoadmapVisibility,
  TSimpleRoadmapFilter,
} from "./schema";

export const toMutableRoadmapFilter = (filter: TSimpleRoadmapFilter) => ({
  version: filter.version,
  operator: filter.operator,
  conditions: filter.conditions.map((condition) => ({
    ...condition,
    value: [...condition.value],
  })),
});

const makeRoadmapRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const findMany = ({
    organizationId,
    visibility,
  }: TRoadmapList & { visibility?: TRoadmapVisibility }) =>
    Effect.gen(function* () {
      const roadmaps = yield* db
        .select()
        .from(schema.roadmapTable)
        .where(
          and(
            eq(schema.roadmapTable.organizationId, organizationId),
            visibility
              ? eq(schema.roadmapTable.visibility, visibility)
              : undefined
          )
        );
      return roadmaps;
    });

  return {
    findMany,
    create: (input: TRoadmapCreate) =>
      db
        .insert(schema.roadmapTable)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          isPrimary: input.isPrimary ?? false,
          mode: input.mode,
          visibility: input.visibility,
          filter: toMutableRoadmapFilter(input.filter),
        })
        .pipe(Effect.asVoid),
    update: (input: TRoadmapUpdate) =>
      db
        .update(schema.roadmapTable)
        .set({
          name: input.name,
          slug: input.slug,
          description: input.description,
          isPrimary: input.isPrimary,
          mode: input.mode,
          visibility: input.visibility,
          filter: toMutableRoadmapFilter(input.filter),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.roadmapTable.id, input.id),
            eq(schema.roadmapTable.organizationId, input.organizationId)
          )
        )
        .pipe(Effect.asVoid),
    delete: ({ id, organizationId }: TRoadmapDelete) =>
      db
        .delete(schema.roadmapTable)
        .where(
          and(
            eq(schema.roadmapTable.id, id),
            eq(schema.roadmapTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),
  };
});

export class RoadmapRepository extends Context.Service<RoadmapRepository>()(
  "RoadmapRepository",
  { make: makeRoadmapRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
