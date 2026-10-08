import { currentDb, schema } from "@feeblo/db";
import { and, asc, count, eq, sql } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BadRequestError, NotFoundError } from "../rpc-errors";
import type {
  TPostStatusCreate,
  TPostStatusDelete,
  TPostStatusDeletePreview,
  TPostStatusDeletePreviewResult,
  TPostStatusDeleteResult,
  TPostStatusList,
  TPostStatusReorder,
  TPostStatusUpdate,
} from "./schema";

const PostStatusColumns = {
  id: schema.postStatusTable.id,
  type: schema.postStatusTable.type,
  label: schema.postStatusTable.label,
  color: schema.postStatusTable.color,
  orderIndex: schema.postStatusTable.orderIndex,
  isDefault: schema.postStatusTable.isDefault,
  organizationId: schema.postStatusTable.organizationId,
  createdAt: schema.postStatusTable.createdAt,
  updatedAt: schema.postStatusTable.updatedAt,
};

/**
 * The read order is the workspace's own `orderIndex`, flat.
 *
 * Deliberately not grouped by type: this list is what `GET /api/v1/statuses`
 * and the anonymous portal list return, and both are published shapes whose
 * array order a workspace can already see. The statuses settings page is the
 * only surface that wants sections, and it groups by `type` itself.
 */
const byOrderIndex = <Status extends { orderIndex: number }>(
  statuses: readonly Status[]
): Status[] =>
  statuses.toSorted((left, right) => left.orderIndex - right.orderIndex);

/**
 * The position a status appended to the end of the workspace's list takes.
 *
 * Every section's rows are a subset of one ascending sequence, so the maximum
 * is also the end of whichever section the caller is appending to, and it is
 * free by construction.
 */
const nextOrderIndex = () =>
  sql<number>`coalesce(max(${schema.postStatusTable.orderIndex}), -1) + 1`;

const makePostStatusRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const findMany = ({ organizationId }: TPostStatusList) =>
    db
      .select(PostStatusColumns)
      .from(schema.postStatusTable)
      .where(eq(schema.postStatusTable.organizationId, organizationId))
      .orderBy(asc(schema.postStatusTable.orderIndex))
      .pipe(Effect.map(byOrderIndex));

  /**
   * What a delete would touch, so the confirmation can say it before it runs.
   *
   * One query per count rather than a join: they read three unrelated tables,
   * and a status is deleted once in a while rather than on a hot path.
   */
  const previewDelete = ({ id, organizationId }: TPostStatusDeletePreview) =>
    Effect.gen(function* () {
      const target = yield* db
        .select({ id: schema.postStatusTable.id })
        .from(schema.postStatusTable)
        .where(
          and(
            eq(schema.postStatusTable.id, id),
            eq(schema.postStatusTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map(EffectArray.get(0)));

      if (Option.isNone(target)) {
        return yield* new NotFoundError({
          message: "Status does not belong to this workspace",
        });
      }

      const posts = yield* db
        .select({ value: count() })
        .from(schema.postTable)
        .where(eq(schema.postTable.statusId, id));

      const columns = yield* db
        .select({ value: count() })
        .from(schema.roadmapColumnTable)
        .where(
          and(
            sql`${schema.roadmapColumnTable.config} ->> 'type' = 'status'`,
            sql`${schema.roadmapColumnTable.config} ->> 'statusId' = ${id}`
          )
        );

      const rules = yield* db
        .select({ value: count() })
        .from(schema.githubSyncRuleTable)
        .where(eq(schema.githubSyncRuleTable.postStatusId, id));

      return {
        postCount: posts[0]?.value ?? 0,
        roadmapColumnCount: columns[0]?.value ?? 0,
        syncRuleCount: rules[0]?.value ?? 0,
      } satisfies TPostStatusDeletePreviewResult;
    });

  return {
    findMany,
    previewDelete,

    create: ({ organizationId, ...input }: TPostStatusCreate) =>
      db
        .insert(schema.postStatusTable)
        .values({
          id: input.id,
          organizationId,
          type: input.type,
          label: input.label,
          color: input.color,
          orderIndex: input.orderIndex,
          // Never taken from the payload: a workspace has exactly one default,
          // and it is the seeded PENDING status until something deliberately
          // changes it.
          isDefault: false,
        })
        .pipe(Effect.asVoid),

    update: ({ organizationId, ...input }: TPostStatusUpdate) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const current = yield* tx
            .select({
              id: schema.postStatusTable.id,
              type: schema.postStatusTable.type,
              orderIndex: schema.postStatusTable.orderIndex,
            })
            .from(schema.postStatusTable)
            .where(
              and(
                eq(schema.postStatusTable.id, input.id),
                eq(schema.postStatusTable.organizationId, organizationId)
              )
            )
            .limit(1)
            .pipe(Effect.map(EffectArray.get(0)));

          if (Option.isNone(current)) {
            return yield* new NotFoundError({
              message: "Status does not belong to this workspace",
            });
          }

          const now = yield* DateTime.nowAsDate;
          // A status that changes section is appended to the end of its new
          // one: its old position was a position among its old section's rows
          // and means nothing where it is going.
          const orderIndex =
            current.value.type === input.type
              ? current.value.orderIndex
              : yield* tx
                  .select({ value: nextOrderIndex() })
                  .from(schema.postStatusTable)
                  .where(
                    eq(schema.postStatusTable.organizationId, organizationId)
                  )
                  .pipe(Effect.map((rows) => rows[0]?.value ?? 0));

          yield* tx
            .update(schema.postStatusTable)
            .set({
              type: input.type,
              label: input.label,
              color: input.color,
              orderIndex,
              updatedAt: now,
            })
            .where(eq(schema.postStatusTable.id, input.id));
        })
      ),

    /**
     * Deletes a status, moving its posts to the workspace's default first.
     *
     * The posts are repointed without an activity row, a notification or a
     * webhook delivery: collapsing a status is a configuration change, and
     * fanning out one event per affected post would turn an administrative
     * cleanup into a burst of customer-visible mail.
     */
    delete: ({ id, organizationId }: TPostStatusDelete) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const target = yield* tx
            .select({
              id: schema.postStatusTable.id,
              isDefault: schema.postStatusTable.isDefault,
            })
            .from(schema.postStatusTable)
            .where(
              and(
                eq(schema.postStatusTable.id, id),
                eq(schema.postStatusTable.organizationId, organizationId)
              )
            )
            .limit(1)
            .pipe(Effect.map(EffectArray.get(0)));

          if (Option.isNone(target)) {
            return yield* new NotFoundError({
              message: "Status does not belong to this workspace",
            });
          }

          if (target.value.isDefault) {
            return yield* new BadRequestError({
              message:
                "The default status cannot be deleted. Move its posts to another status first.",
            });
          }

          const fallback = yield* tx
            .select({ id: schema.postStatusTable.id })
            .from(schema.postStatusTable)
            .where(
              and(
                eq(schema.postStatusTable.organizationId, organizationId),
                eq(schema.postStatusTable.isDefault, true)
              )
            )
            .limit(1)
            .pipe(Effect.map(EffectArray.get(0)));

          if (Option.isNone(fallback)) {
            return yield* new BadRequestError({
              message:
                "This workspace has no default status, so there is nowhere to move its posts.",
            });
          }

          const now = yield* DateTime.nowAsDate;

          const movedPosts = yield* tx
            .select({ value: count() })
            .from(schema.postTable)
            .where(eq(schema.postTable.statusId, id));

          // Counted before the delete because the database cascades these
          // away with the status row; the confirmation dialog names them.
          const syncRules = yield* tx
            .select({ value: count() })
            .from(schema.githubSyncRuleTable)
            .where(eq(schema.githubSyncRuleTable.postStatusId, id));

          yield* tx
            .update(schema.postTable)
            .set({ statusId: fallback.value.id, updatedAt: now })
            .where(eq(schema.postTable.statusId, id));

          // A roadmap lane bound to a status that no longer exists renders as
          // a permanently empty column, so the column goes with the status.
          const removedColumns = yield* tx
            .delete(schema.roadmapColumnTable)
            .where(
              and(
                sql`${schema.roadmapColumnTable.config} ->> 'type' = 'status'`,
                sql`${schema.roadmapColumnTable.config} ->> 'statusId' = ${id}`
              )
            )
            .returning({ id: schema.roadmapColumnTable.id });

          yield* tx
            .delete(schema.postStatusTable)
            .where(eq(schema.postStatusTable.id, id));

          return {
            movedPostCount: movedPosts[0]?.value ?? 0,
            removedRoadmapColumnCount: removedColumns.length,
            removedSyncRuleCount: syncRules[0]?.value ?? 0,
          } satisfies TPostStatusDeleteResult;
        })
      ),

    /**
     * Applies one section's new order.
     *
     * The payload must name exactly that section's statuses, once each: a
     * partial list would leave rows whose position is neither the old order nor
     * the new one, and an unknown id would silently do nothing.
     */
    reorder: ({ organizationId, type, orderedIds }: TPostStatusReorder) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const rows = yield* tx
            .select({
              id: schema.postStatusTable.id,
              orderIndex: schema.postStatusTable.orderIndex,
            })
            .from(schema.postStatusTable)
            .where(
              and(
                eq(schema.postStatusTable.organizationId, organizationId),
                eq(schema.postStatusTable.type, type)
              )
            )
            .orderBy(asc(schema.postStatusTable.orderIndex));

          const requested = new Set<string>(orderedIds);
          const coversSection =
            orderedIds.length === rows.length &&
            requested.size === orderedIds.length &&
            rows.every((row) => requested.has(row.id));

          if (!coversSection) {
            return yield* new BadRequestError({
              message:
                "A reorder must name every status in the section exactly once.",
            });
          }

          const now = yield* DateTime.nowAsDate;
          const positions = rows
            .map((row) => row.orderIndex)
            .toSorted((left, right) => left - right);

          // Two passes, because the new positions are a permutation of the old
          // ones and assigning them one row at a time would transiently collide
          // with the unique index on (organization_id, order_index). Parking
          // the section on negative positions — which no other row can hold —
          // makes the second pass collision-free.
          yield* tx
            .update(schema.postStatusTable)
            .set({
              orderIndex: sql`-${schema.postStatusTable.orderIndex} - 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.postStatusTable.organizationId, organizationId),
                eq(schema.postStatusTable.type, type)
              )
            );

          for (const [index, id] of orderedIds.entries()) {
            const position = positions[index];

            if (position === undefined) {
              continue;
            }

            yield* tx
              .update(schema.postStatusTable)
              .set({ orderIndex: position, updatedAt: now })
              .where(eq(schema.postStatusTable.id, id));
          }
        })
      ),
  };
});

export class PostStatusRepository extends Context.Service<PostStatusRepository>()(
  "PostStatusRepository",
  {
    make: makePostStatusRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so the Public API's operations take it from the context the
 * composition provides — the same shape as `currentTagRepository`.
 */
export const currentPostStatusRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PostStatusRepository))
);
