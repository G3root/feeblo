import { currentDb, schema } from "@feeblo/db";
import { and, asc, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  TRoadmapColumnCreate,
  TRoadmapColumnDelete,
  TRoadmapColumnList,
  TRoadmapColumnUpdate,
} from "./schema";

const makeRoadmapColumnRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  return {
    findMany: ({ roadmapId }: TRoadmapColumnList) =>
      db
        .select()
        .from(schema.roadmapColumnTable)
        .where(eq(schema.roadmapColumnTable.roadmapId, roadmapId))
        .orderBy(asc(schema.roadmapColumnTable.position)),
    create: ({
      organizationId: _organizationId,
      ...input
    }: TRoadmapColumnCreate) =>
      db.insert(schema.roadmapColumnTable).values(input).pipe(Effect.asVoid),
    update: ({
      organizationId: _organizationId,
      ...input
    }: TRoadmapColumnUpdate) =>
      db
        .update(schema.roadmapColumnTable)
        .set({
          name: input.name,
          position: input.position,
          config: input.config,
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
