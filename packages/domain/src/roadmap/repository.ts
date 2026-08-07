import { currentDb, schema } from "@feeblo/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { getUniqueViolationConstraint, isUniqueViolation } from "../rpc-errors";
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

/**
 * Serializes roadmap create/delete per organization by locking the
 * organization row for the duration of the transaction. The single-primary
 * invariant is a per-organization, table-level condition, so row locks on
 * individual roadmaps cannot enforce it: two concurrent deletes could each
 * lock a different roadmap row, then delete it, and race on successor
 * selection. Locking the organization row makes primary deletion, successor
 * selection, and promotion atomic relative to every other create/delete for
 * the same organization.
 */
const makeRoadmapRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const lockOrganization = (organizationId: string) =>
    db.execute(
      sql`SELECT id FROM ${schema.organizationTable} WHERE id = ${organizationId} FOR UPDATE`
    );
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
    getById: ({ id, organizationId }: { id: string; organizationId: string }) =>
      db
        .select({
          id: schema.roadmapTable.id,
          isPrimary: schema.roadmapTable.isPrimary,
          visibility: schema.roadmapTable.visibility,
        })
        .from(schema.roadmapTable)
        .where(
          and(
            eq(schema.roadmapTable.id, id),
            eq(schema.roadmapTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0))),
    /**
     * Deletes a roadmap and, when it was the primary, promotes a successor in
     * the same organization-scoped transaction. The organization row lock
     * serializes this against concurrent roadmap creates/deletes so that
     * deletion, successor selection, and promotion are atomic: a concurrent
     * delete can never remove the freshly promoted successor, and a concurrent
     * create can never claim primary in the gap between delete and promotion.
     */
    deleteWithPrimaryHandoff: ({ id, organizationId }: TRoadmapDelete) =>
      db.transaction(() =>
        Effect.gen(function* () {
          yield* lockOrganization(organizationId);

          const [roadmap] = yield* db
            .select({
              id: schema.roadmapTable.id,
              isPrimary: schema.roadmapTable.isPrimary,
            })
            .from(schema.roadmapTable)
            .where(
              and(
                eq(schema.roadmapTable.id, id),
                eq(schema.roadmapTable.organizationId, organizationId)
              )
            )
            .limit(1);

          yield* db
            .delete(schema.roadmapTable)
            .where(
              and(
                eq(schema.roadmapTable.id, id),
                eq(schema.roadmapTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.asVoid);

          if (!roadmap?.isPrimary) {
            return;
          }

          const [next] = yield* db
            .select({ id: schema.roadmapTable.id })
            .from(schema.roadmapTable)
            .where(
              and(
                eq(schema.roadmapTable.organizationId, organizationId),
                ne(schema.roadmapTable.id, id)
              )
            )
            .orderBy(
              asc(schema.roadmapTable.createdAt),
              asc(schema.roadmapTable.id)
            )
            .limit(1);

          if (!next) {
            return;
          }

          yield* db
            .update(schema.roadmapTable)
            .set({ isPrimary: true, updatedAt: new Date() })
            .where(eq(schema.roadmapTable.id, next.id))
            .pipe(Effect.asVoid);
        })
      ),
    create: (input: TRoadmapCreate) =>
      db.transaction(() =>
        Effect.gen(function* () {
          // Serialize with deletes so the primary claim below always observes
          // the post-delete state: without the lock, a create could fall back
          // to a non-primary insert while a concurrent primary delete was still
          // uncommitted, leaving the organization with no primary at all.
          yield* lockOrganization(input.organizationId);

          const values = {
            id: input.id,
            organizationId: input.organizationId,
            name: input.name,
            slug: input.slug,
            description: input.description ?? null,
            mode: input.mode,
            visibility: input.visibility,
            filter: toMutableRoadmapFilter(input.filter),
          };
          const insert = (isPrimary: boolean) =>
            db
              .insert(schema.roadmapTable)
              .values({ ...values, isPrimary })
              .pipe(Effect.asVoid);

          if (input.isPrimary) {
            // Claim primary status atomically instead of racing count-then-create:
            // the partial unique index roadmap_primary_organizationId_uidx allows
            // at most one primary per organization, so when a concurrent create
            // already claimed it this insert fails with a unique violation and we
            // fall back to a regular (non-primary) create. Each attempt runs in
            // its own savepoint (nested db.transaction) so the failed insert does
            // not abort the enclosing transaction.
            yield* db
              .transaction(() => insert(true))
              .pipe(
                Effect.catchIf(
                  (error) =>
                    isUniqueViolation(error) &&
                    getUniqueViolationConstraint(error) ===
                      "roadmap_primary_organizationId_uidx",
                  () => db.transaction(() => insert(false))
                )
              );
            return;
          }

          yield* db.transaction(() => insert(false));
        })
      ),
    update: (input: Omit<TRoadmapUpdate, "isPrimary">) =>
      db
        .update(schema.roadmapTable)
        .set({
          name: input.name,
          slug: input.slug,
          description: input.description,
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
  };
});

export class RoadmapRepository extends Context.Service<RoadmapRepository>()(
  "RoadmapRepository",
  { make: makeRoadmapRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}
